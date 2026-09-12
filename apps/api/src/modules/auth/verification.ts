/**
 * E-mail ownership proof.
 *
 * A token is random, single-use and short-lived, and only its hash reaches the
 * database — the same treatment sessions get, for the same reason: a dump of
 * the table must not contain anything that still works.
 */
import { createHash, randomBytes } from 'node:crypto';
import { TokenPurpose } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { sendMail } from '../../lib/mailer';
import { badRequest } from '../../lib/errors';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a fresh link and mails it.
 *
 * Any earlier unused token for the same purpose is burned first, so a person
 * who asks twice cannot be confused by two live links, and an old message
 * forwarded on is worthless.
 */
export async function sendVerificationEmail(user: { id: string; email: string; name: string }): Promise<void> {
  await prisma.verificationToken.deleteMany({
    where: { userId: user.id, purpose: TokenPurpose.EMAIL_VERIFICATION, usedAt: null },
  });

  const token = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hash(token),
      purpose: TokenPurpose.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + env.EMAIL_TOKEN_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  const origin = env.WEB_ORIGIN.split(',')[0]?.trim() ?? '';
  const link = `${origin}/verify-email?token=${token}`;

  await sendMail({
    to: user.email,
    subject: 'Подтвердите почту — FlowDesk',
    text: [
      `${user.name}, здравствуйте.`,
      '',
      'Чтобы закончить регистрацию в FlowDesk, откройте ссылку:',
      link,
      '',
      `Ссылка действует ${env.EMAIL_TOKEN_TTL_HOURS} ч.`,
      'Если вы не регистрировались, просто удалите это письмо — без перехода по ссылке ничего не произойдёт.',
    ].join('\n'),
  });
}

/** Consumes a token and marks the address proven. */
export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hash(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true },
  });

  // One message for every failure mode on purpose: which of "wrong", "already
  // used" and "expired" applies is not something a stranger holding a guessed
  // token should learn.
  const invalid = badRequest('Ссылка недействительна или устарела. Запросите новое письмо.');
  if (!record || record.purpose !== TokenPurpose.EMAIL_VERIFICATION) throw invalid;
  if (record.usedAt || record.expiresAt < new Date()) throw invalid;

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
}

/**
 * Whether sign-in should be refused for an unverified address.
 *
 * Only when mail is actually configured. With MAIL_ENABLED=false nobody could
 * ever receive a link, so enforcing it would lock every account out — including
 * the first one, before anything could be fixed.
 */
export function verificationRequired(): boolean {
  return env.MAIL_ENABLED;
}
