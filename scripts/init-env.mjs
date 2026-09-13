#!/usr/bin/env node
/**
 * Creates `apps/api/.env` on a fresh clone.
 *
 * The API refuses to start without a real SESSION_SECRET, and it also rejects
 * the placeholder shipped in `.env.example` — deliberately, so nobody runs
 * production on a value that is in the repository. The consequence is that
 * copying the example by hand does not produce a working setup, which makes a
 * first clone fail for a reason that has nothing to do with the project.
 *
 * So the secret is generated here instead. Written once and never touched
 * again: an existing file is left exactly as it is, because it may hold
 * credentials this script has no business rewriting.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps', 'api', '.env');
const example = join(root, '.env.example');

if (existsSync(target)) {
  console.log('apps/api/.env уже есть — не трогаю');
  process.exit(0);
}

if (!existsSync(example)) {
  console.error('.env.example не найден — нечего копировать');
  process.exit(1);
}

const secret = randomBytes(48).toString('base64url');
const content = readFileSync(example, 'utf8').replace(
  /^SESSION_SECRET=.*$/m,
  `SESSION_SECRET="${secret}"`,
);

writeFileSync(target, content, 'utf8');
console.log('создан apps/api/.env со сгенерированным SESSION_SECRET');
