import type { FastifyInstance } from 'fastify';
import { Permission, canDeleteComment } from '@flowdesk/contracts';
import { prisma } from '../../lib/prisma';
import { assertCan, issueContext, workspaceContext } from '../../lib/context';
import { currentUser, requireAuth } from '../../plugins/auth';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { PREVIEWABLE_MIME, isMimeAllowed, safeFilename, storage } from '../../lib/storage';
import { attachmentSelect, toAttachment } from '../../lib/serialize';
import { env } from '../../config/env';

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post<{ Params: { issueId: string } }>('/issues/:issueId/attachments', async (req, reply) => {
    const { actor } = await issueContext(currentUser(req).id, req.params.issueId);
    assertCan(actor, Permission.ATTACHMENT_UPLOAD);

    const file = await req.file({ limits: { fileSize: env.MAX_UPLOAD_BYTES } });
    if (!file) throw badRequest('Файл не был загружен');

    const mimeType = (file.mimetype || 'application/octet-stream').toLowerCase();
    if (!isMimeAllowed(mimeType)) throw badRequest('Такой тип файла не разрешён');

    const filename = safeFilename(file.filename ?? 'file');
    const { key, size } = await storage.save(file.file, { filename, mimeType });

    // `truncated` is set when the stream hit the size limit mid-upload.
    if (file.file.truncated) {
      await storage.remove(key);
      throw badRequest(`File exceeds the ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`);
    }

    const attachment = await prisma.attachment.create({
      data: {
        issueId: req.params.issueId,
        uploaderId: actor.userId,
        filename,
        mimeType,
        size,
        storageKey: key,
      },
      select: attachmentSelect,
    });

    await prisma.activityEvent.create({
      data: {
        issueId: req.params.issueId,
        actorId: actor.userId,
        type: 'ATTACHMENT_ADDED',
        toValue: filename,
      },
    });

    return reply.status(201).send(toAttachment(attachment));
  });

  /**
   * Serves file bytes. Access is re-checked here — an attachment URL must not
   * be a capability that works for anyone who learns the id.
   */
  app.get<{ Params: { attachmentId: string } }>('/attachments/:attachmentId/content', async (req, reply) => {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.attachmentId },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        storageKey: true,
        issue: { select: { id: true, project: { select: { workspaceId: true } } } },
        comment: { select: { issue: { select: { id: true, project: { select: { workspaceId: true } } } } } },
      },
    });
    if (!attachment) throw notFound('Файл');

    const issue = attachment.issue ?? attachment.comment?.issue;
    if (!issue) throw notFound('Файл');
    await issueContext(currentUser(req).id, issue.id);

    const inline = PREVIEWABLE_MIME.has(attachment.mimeType);
    const encoded = encodeURIComponent(attachment.filename);

    return reply
      .header('Content-Type', inline ? attachment.mimeType : 'application/octet-stream')
      .header('Content-Length', String(attachment.size))
      // Prevents a browser from sniffing an uploaded file into something executable.
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
      )
      .send(storage.read(attachment.storageKey));
  });

  app.delete<{ Params: { attachmentId: string } }>('/attachments/:attachmentId', async (req, reply) => {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.attachmentId },
      select: {
        id: true,
        uploaderId: true,
        storageKey: true,
        filename: true,
        issueId: true,
        issue: { select: { project: { select: { workspaceId: true } } } },
        comment: { select: { issue: { select: { project: { select: { workspaceId: true } } } } } },
      },
    });
    if (!attachment) throw notFound('Файл');

    const workspaceId =
      attachment.issue?.project.workspaceId ?? attachment.comment?.issue.project.workspaceId;
    if (!workspaceId) throw notFound('Файл');

    const actor = await workspaceContext(currentUser(req).id, workspaceId);
    if (!canDeleteComment(actor, attachment.uploaderId)) {
      throw forbidden('Удалять можно только свои файлы');
    }

    await prisma.attachment.delete({ where: { id: attachment.id } });
    await storage.remove(attachment.storageKey);

    if (attachment.issueId) {
      await prisma.activityEvent.create({
        data: {
          issueId: attachment.issueId,
          actorId: actor.userId,
          type: 'ATTACHMENT_REMOVED',
          fromValue: attachment.filename,
        },
      });
    }

    return reply.status(204).send();
  });
}
