/** Zod → AppError bridge. Every route parses untrusted input through this. */
import type { ZodError, ZodTypeAny, z } from 'zod';
import { validationError } from './errors';

function fieldMap(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = fieldMap(result.error);
    const first = Object.entries(fields)[0];
    throw validationError(first ? `${first[0]}: ${first[1]}` : 'Invalid request', fields);
  }
  return result.data;
}
