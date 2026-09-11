import { prisma } from '../../lib/prisma';

export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'workspace';
}

/** Appends `-2`, `-3`, … until the slug is free. */
export async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let i = 2; i < 100; i += 1) {
    const taken = await prisma.workspace.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}
