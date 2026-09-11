/**
 * Single error boundary. Clients get a stable `{ error: { code, message } }`
 * body and never a stack trace; the full error goes to the structured log with
 * the request id so it can be correlated.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@flowdesk/contracts';
import { AppError } from '../lib/errors';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    const body: ApiErrorBody = {
      error: { code: 'NOT_FOUND', message: `Маршрут ${req.method} ${req.url} не найден`, requestId: req.id },
    };
    reply.status(404).send(body);
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) req.log.error({ err: error }, 'application error');
      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
          requestId: req.id,
        },
      };
      return reply.status(error.statusCode).send(body);
    }

    if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) fields[issue.path.join('.') || '_'] = issue.message;
      const body: ApiErrorBody = {
        error: { code: 'VALIDATION_ERROR', message: 'Некорректный запрос', fields, requestId: req.id },
      };
      return reply.status(422).send(body);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 unique constraint, P2025 record not found — map to user-facing codes.
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
        const body: ApiErrorBody = {
          error: { code: 'CONFLICT', message: `Значение «${target}» уже занято`, requestId: req.id },
        };
        return reply.status(409).send(body);
      }
      if (error.code === 'P2025') {
        const body: ApiErrorBody = {
          error: { code: 'NOT_FOUND', message: 'Объект не найден', requestId: req.id },
        };
        return reply.status(404).send(body);
      }
      if (error.code === 'P2003') {
        const body: ApiErrorBody = {
          error: { code: 'BAD_REQUEST', message: 'Связанная запись не существует', requestId: req.id },
        };
        return reply.status(400).send(body);
      }
    }

    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    if (statusCode === 429) {
      const body: ApiErrorBody = {
        error: { code: 'RATE_LIMITED', message: 'Слишком много запросов — немного подождите', requestId: req.id },
      };
      return reply.status(429).send(body);
    }
    if (statusCode === 413) {
      const body: ApiErrorBody = {
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Файл слишком большой', requestId: req.id },
      };
      return reply.status(413).send(body);
    }
    if (statusCode >= 400 && statusCode < 500) {
      const body: ApiErrorBody = {
        error: { code: 'BAD_REQUEST', message: err.message || 'Некорректный запрос', requestId: req.id },
      };
      return reply.status(statusCode).send(body);
    }

    req.log.error({ err: error }, 'unhandled error');

    // The client never receives an internal message, in any environment: a
    // stack trace or a driver error in the UI is both a poor experience and an
    // information leak. Developers get the full error in the server log, keyed
    // by the same requestId the user is shown.
    const body: ApiErrorBody = {
      error: {
        code: 'INTERNAL',
        message: 'Что-то пошло не так на нашей стороне',
        requestId: req.id,
      },
    };
    return reply.status(500).send(body);
  });
}
