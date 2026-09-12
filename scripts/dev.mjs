#!/usr/bin/env node
/**
 * Cross-platform replacement for `npm run dev:api & npm run dev:web`.
 *
 * Spawns both dev servers with prefixed output and tears the surviving one
 * down when its sibling exits, so Ctrl+C never leaves an orphaned API on
 * :4000 and no shell-specific `&` is involved. npm nests the real server a
 * few processes deep (npm -> sh -> tsx/vite), so teardown kills the whole
 * process tree, not just the direct child.
 */
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const children = new Map();
let shuttingDown = false;

/** Streams deliver partial lines; buffer so every emitted line keeps its tag. */
function forward(stream, tag) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      process.stdout.write(`[${tag}] ${pending.slice(0, newline + 1)}`);
      pending = pending.slice(newline + 1);
    }
  });
  stream.on('end', () => {
    if (pending) process.stdout.write(`[${tag}] ${pending}\n`);
  });
}

/** A signal-terminated child has no exit code — use the shell's 128 + n convention. */
function exitCodeFor(code, signal) {
  if (code !== null) return code;
  const number = osConstants.signals[signal];
  return number ? 128 + number : 1;
}

/**
 * Kill a server and everything it spawned. POSIX children run in their own
 * process group (detached), so signalling `-pid` reaches npm's grandchildren
 * too; Windows has no process groups, where taskkill /T does the same.
 */
function killTree(child, force) {
  if (isWindows) {
    const args = ['/pid', String(child.pid), '/T'];
    if (force) args.push('/F');
    spawn('taskkill', args, { stdio: 'ignore' }).unref();
    return;
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    /* already exited */
  }
}

function shutdown(code, signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) killTree(child, false);
  // Escalate if a server refuses to die, and never linger past the deadline.
  const escalate = setTimeout(() => {
    for (const child of children.values()) killTree(child, true);
  }, 3_000);
  escalate.unref();
  const deadline = setTimeout(() => process.exit(exitCodeFor(code, signal)), 5_000);
  deadline.unref();
}

function start(tag, script) {
  const child = spawn(npm, ['run', script], {
    // .cmd batch files need a shell on Windows; POSIX spawns npm directly.
    // Detached puts the child in its own process group so killTree is a
    // true tree kill — and means the terminal's Ctrl+C reaches it only
    // through our explicit forward below.
    shell: isWindows,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forward(child.stdout, tag);
  forward(child.stderr, tag);
  child.on('error', (error) => {
    process.stderr.write(`[${tag}] failed to start: ${error.message}\n`);
    shutdown(1, null);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    // Whether the sibling crashed or we are answering SIGINT ourselves, the
    // other server has no reason to stay up — and the status propagates.
    shutdown(code, signal);
    process.exitCode = exitCodeFor(code, signal);
    // Orphaned grandchildren would keep the pipes open and block the exit;
    // with the tree killed that should not happen, but never hang on it.
    const allGone = [...children.values()].every((c) => c.exitCode !== null || c.signalCode !== null);
    if (allGone) {
      for (const c of children.values()) {
        c.stdout?.destroy();
        c.stderr?.destroy();
      }
    }
  });
  children.set(tag, child);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // Forward only; the child's exit event drives teardown so the reported
    // status stays faithful to whichever server died first.
    for (const child of children.values()) {
      if (isWindows) child.kill();
      else {
        try {
          process.kill(-child.pid, signal);
        } catch {
          /* already exited */
        }
      }
    }
  });
}

start('api', 'dev:api');
start('web', 'dev:web');
