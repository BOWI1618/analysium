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
import { hashPassword } from '../../lib/password';

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

/**
 * Invites someone into a workspace by mail.
 *
 * The link is what makes the invitation usable at all: until it is opened the
 * account has no password, so there is no way in. Any earlier unused invite is
 * replaced, so re-inviting somebody simply sends a fresh, working link.
 */
export async function sendInviteEmail(args: {
  user: { id: string; email: string };
  workspaceName: string;
  invitedByName: string;
}): Promise<void> {
  await prisma.verificationToken.deleteMany({
    where: { userId: args.user.id, purpose: TokenPurpose.INVITE, usedAt: null },
  });

  const token = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      userId: args.user.id,
      tokenHash: hash(token),
      purpose: TokenPurpose.INVITE,
      expiresAt: new Date(Date.now() + env.INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  const origin = env.WEB_ORIGIN.split(',')[0]?.trim() ?? '';
  await sendMail({
    to: args.user.email,
    subject: `Приглашение в «${args.workspaceName}» — FlowDesk`,
    text: [
      `${args.invitedByName} приглашает вас в пространство «${args.workspaceName}» в FlowDesk.`,
      '',
      'Чтобы принять приглашение и задать пароль, откройте ссылку:',
      `${origin}/accept-invite?token=${token}`,
      '',
      `Ссылка действует ${env.INVITE_TOKEN_TTL_DAYS} дн.`,
      'Если вы не ждали этого письма, просто удалите его.',
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

/**
 * Turns an invitation into a usable account.
 *
 * The link itself proves the address, so the person is verified on the spot —
 * asking them to confirm a second time would be theatre. If they already had a
 * password (invited to a second workspace), it is left alone: the membership is
 * what the invitation grants, not a new identity.
 */
export async function acceptInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ id: string; alreadyRegistered: boolean }> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hash(input.token) },
    select: {
      id: true,
      purpose: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { id: true, passwordHash: true } },
    },
  });

  const invalid = badRequest('Приглашение недействительно или устарело. Попросите новое.');
  if (!record || record.purpose !== TokenPurpose.INVITE) throw invalid;
  if (record.usedAt || record.expiresAt < new Date()) throw invalid;

  const alreadyRegistered = Boolean(record.user.passwordHash);

  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: record.user.id },
      data: {
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        ...(alreadyRegistered
          ? {}
          : { name: input.name, passwordHash: await hashPassword(input.password) }),
      },
    }),
  ]);

  return { id: record.user.id, alreadyRegistered };
}
