/**
 * One error taxonomy for the whole API. Handlers throw these; a single
 * Fastify error handler maps them to status codes and a stable JSON body.
 * Internal details never reach the client — they go to the log.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly fields?: Record<string, string>;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.fields = fields;
    this.expose = code !== 'INTERNAL';
  }
}

export const badRequest = (m: string, f?: Record<string, string>) => new AppError('BAD_REQUEST', m, f);
export const validationError = (m: string, f?: Record<string, string>) => new AppError('VALIDATION_ERROR', m, f);
export const unauthorized = (m = 'Требуется вход') => new AppError('UNAUTHORIZED', m);
export const forbidden = (m = 'Недостаточно прав для этого действия') => new AppError('FORBIDDEN', m);
export const notFound = (entity = 'Объект') => new AppError('NOT_FOUND', `${entity} не найден`);
export const conflict = (m: string, f?: Record<string, string>) => new AppError('CONFLICT', m, f);

/**
 * Guards against IDOR: every lookup that scopes by workspace/project should
 * funnel through this so a missing row and an inaccessible row are
 * indistinguishable to the caller.
 */
export function assertFound<T>(value: T | null | undefined, entity: string): T {
  if (value === null || value === undefined) throw notFound(entity);
  return value;
}
