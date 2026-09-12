/**
 * Logger for service-layer code that runs outside the Fastify request
 * lifecycle (post-commit notification fan-out, background jobs) and therefore
 * has no `req.log` / `app.log` at hand. Call shape mirrors pino:
 * `log.warn({ err }, 'message')`.
 */
function write(level: 'warn' | 'error', obj: unknown, msg?: string): void {
  if (msg === undefined) {
    console[level](obj);
    return;
  }
  console[level](msg, obj);
}

export const log = {
  warn: (obj: unknown, msg?: string) => write('warn', obj, msg),
  error: (obj: unknown, msg?: string) => write('error', obj, msg),
};
