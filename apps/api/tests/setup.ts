/**
 * Integration-test harness.
 *
 * Tests run against a real PostgreSQL database in its own schema, so the
 * queries, constraints and transactions under test are the ones that run in
 * production — an in-memory fake would not catch a broken foreign key or a
 * unique-index race. The schema is created once per run and dropped at the end.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE = process.env.TEST_DATABASE_NAME ?? 'flowdesk_test';

const sourceUrl = new URL(
  process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://flowdesk:flowdesk@localhost:5433/flowdesk',
);

/** Same server and credentials, different database. */
function urlForDatabase(name: string): string {
  const url = new URL(sourceUrl.toString());
  url.pathname = `/${name}`;
  url.search = '';
  return url.toString();
}

/**
 * Tests get their own database rather than a schema inside the development one.
 * A schema cannot own its own copy of `pg_trgm` — extensions are per-database —
 * and it kept the trigram indexes from being created. A separate database also
 * means a mistyped URL can never touch development data.
 */
process.env.DATABASE_URL = urlForDatabase(TEST_DATABASE);
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-secret-value-at-least-24-chars-long';
// Rate limits would make the suite flaky; the limiter has its own test.
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';

export async function migrateTestSchema(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');

  // Dropping a database requires a connection to a different one.
  const maintenance = new PrismaClient({
    datasources: { db: { url: urlForDatabase('postgres') } },
  });
  try {
    await maintenance.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DATABASE}' AND pid <> pg_backend_pid()`,
    );
    await maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DATABASE}"`);
    await maintenance.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE}"`);
  } finally {
    await maintenance.$disconnect();
  }

  const target = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  try {
    await target.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  } finally {
    await target.$disconnect();
  }

  execSync('npx prisma db push --skip-generate', { stdio: 'pipe', env: { ...process.env } });
}

export async function dropTestSchema(): Promise<void> {
  const { prisma } = await import('../src/lib/prisma');
  await prisma.$disconnect();
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  cookie: string;
  workspaceId: string;
}

/** Registers a fresh user (and their workspace) and returns a session cookie. */
export async function registerUser(
  app: FastifyInstance,
  overrides: { name?: string; email?: string; workspaceName?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? `user-${randomUUID().slice(0, 8)}@test.local`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      name: overrides.name ?? 'Тестовый Пользователь',
      email,
      password: 'password123',
      ...(overrides.workspaceName ? { workspaceName: overrides.workspaceName } : {}),
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`registerUser failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json();
  return {
    id: body.user.id,
    email,
    name: body.user.name,
    cookie: extractCookie(response.headers['set-cookie']),
    workspaceId: body.workspaces[0].id,
  };
}

function extractCookie(raw: string | string[] | undefined): string {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const session = list.find((c) => c.startsWith('fd_session='));
  if (!session) throw new Error('no session cookie was set');
  return session.split(';')[0]!;
}

export async function login(app: FastifyInstance, email: string, password = 'password123'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
  return extractCookie(response.headers['set-cookie']);
}

/** Adds `email` to `workspaceId` with the given role, as `actor`. */
export async function addMember(
  app: FastifyInstance,
  actor: TestUser,
  email: string,
  role: 'ADMIN' | 'MEMBER' | 'GUEST',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${actor.workspaceId}/members`,
    headers: { cookie: actor.cookie },
    payload: { email, role },
  });
  if (response.statusCode !== 201) throw new Error(`addMember failed: ${response.body}`);
  return response.json().id;
}

export async function createProject(
  app: FastifyInstance,
  actor: TestUser,
  overrides: { name?: string; key?: string; projectType?: string } = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/workspaces/${actor.workspaceId}/projects`,
    headers: { cookie: actor.cookie },
    payload: {
      name: overrides.name ?? 'Тестовый проект',
      key: overrides.key ?? `T${randomUUID().slice(0, 3).toUpperCase()}`,
      projectType: overrides.projectType ?? 'KANBAN',
    },
  });
  if (response.statusCode !== 201) throw new Error(`createProject failed: ${response.body}`);
  return response.json();
}

export async function createIssue(
  app: FastifyInstance,
  actor: TestUser,
  projectId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/issues',
    headers: { cookie: actor.cookie },
    payload: { projectId, title: 'Тестовая задача', ...overrides },
  });
  if (response.statusCode !== 201) throw new Error(`createIssue failed: ${response.body}`);
  return response.json();
}
