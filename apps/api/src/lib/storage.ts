/**
 * Storage abstraction for attachments. Local disk today; swapping in S3 or
 * GCS means implementing this interface and changing one line in the factory —
 * no call site in the modules changes.
 */
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, unlink, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { env } from '../config/env';

export interface StorageAdapter {
  /** Streams `data` to storage and returns the opaque key to persist. */
  save(stream: Readable, opts: { filename: string; mimeType: string }): Promise<{ key: string; size: number }>;
  read(key: string): Readable;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Only these types get an inline preview; everything else downloads. */
export const PREVIEWABLE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

/** Uploaded HTML/SVG/scripts would execute on the download origin — reject them. */
const BLOCKED_MIME = new Set([
  'text/html',
  'image/svg+xml',
  'application/xhtml+xml',
  'application/x-msdownload',
  'application/x-sh',
  'application/javascript',
  'text/javascript',
]);

export function isMimeAllowed(mime: string): boolean {
  return !BLOCKED_MIME.has(mime.toLowerCase());
}

/** Strips directory components and unsafe characters from a client filename. */
export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  const cleaned = base
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 31 && !'<>:"|?*\\/'.includes(ch))
    .join('');
  return cleaned.slice(0, 180) || 'file';
}

class LocalDiskStorage implements StorageAdapter {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Keys are server-generated; the client filename never touches the path. */
  private keyFor(): string {
    const now = new Date();
    const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `${dir}/${randomBytes(16).toString('hex')}`;
  }

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + '/')) {
      throw new Error('Path traversal detected in storage key');
    }
    return full;
  }

  async save(stream: Readable): Promise<{ key: string; size: number }> {
    const key = this.keyFor();
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
    });
    await pipeline(stream, createWriteStream(path));
    return { key, size };
  }

  read(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const storage: StorageAdapter = new LocalDiskStorage(join(process.cwd(), env.UPLOAD_DIR));
