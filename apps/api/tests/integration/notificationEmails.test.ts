import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, createIssue, createProject, disconnectTestDb, migrateTestSchema, registerUser } from '../setup';
import type { Mail } from '../../src/lib/mailer';
import { DIGEST_GAP_MS, UNREAD_DELAY_MS, sendNotificationDigests } from '../../src/jobs/notificationMailer';
import { prisma } from '../../src/lib/prisma';

let app: FastifyInstance;

beforeAll(async () => {
  await migrateTestSchema();
  const { buildApp } = await import('../../src/app');
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await disconnectTestDb();
});

const MINUTE = 60 * 1000;

/** Captures letters instead of sending them. */
function mailbox() {
  const letters: Mail[] = [];
  const send = async (mail: Mail) => {
    letters.push(mail);
    return true;
  };
  return { letters, send };
}

/** Notifications are written after the request answers; wait until they land. */
async function waitForNotifications(userId: string, count: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await prisma.notification.count({ where: { userId } })) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`expected ${count} notifications for ${userId}`);
}

describe('уведомления на почту', () => {
  it('непрочитанное уходит письмом через 10 минут, одно письмо на несколько, не чаще раза в полчаса', async () => {
    const owner = await registerUser(app, { workspaceName: 'Письма' });
    const member = await registerUser(app, { name: 'Вера Почтова' });
    await addMember(app, owner, member.email, 'MEMBER');
    const project = await createProject(app, owner);
    const start = Date.now();

    const first = await createIssue(app, owner, project.id, { title: 'Сверстать шапку', assigneeId: member.id });
    const second = await createIssue(app, owner, project.id, { title: 'Проверить форму', assigneeId: member.id });
    await waitForNotifications(member.id, 2);

    const box = mailbox();
    // Fresh notifications wait: the person may still read them in the app.
    expect(await sendNotificationDigests(new Date(start), box.send)).toBe(0);

    const later = new Date(Date.now() + UNREAD_DELAY_MS + MINUTE);
    expect(await sendNotificationDigests(later, box.send)).toBe(1);
    expect(box.letters).toHaveLength(1);
    const [letter] = box.letters;
    expect(letter!.to).toBe(member.email);
    expect(letter!.subject).toBe('2 новых уведомления в Analysium');
    expect(letter!.text).toContain(`${first.issueKey} назначена на вас — Сверстать шапку`);
    expect(letter!.text).toContain(`/issue/${second.issueKey}`);

    // Mailed once, never again.
    expect(await sendNotificationDigests(new Date(later.getTime() + MINUTE), box.send)).toBe(0);

    // A new one within half an hour of the last letter waits for the gap.
    await createIssue(app, owner, project.id, { title: 'Третья', assigneeId: member.id });
    await waitForNotifications(member.id, 3);
    const tooSoon = new Date(later.getTime() + DIGEST_GAP_MS - MINUTE);
    expect(await sendNotificationDigests(tooSoon, box.send)).toBe(0);
    const afterGap = new Date(later.getTime() + DIGEST_GAP_MS + MINUTE);
    expect(await sendNotificationDigests(afterGap, box.send)).toBe(1);
    expect(box.letters[1]!.subject).toContain('назначена на вас');
  });

  it('прочитанное в приложении не отправляется; письма можно выключить', async () => {
    const owner = await registerUser(app, { workspaceName: 'Тишина' });
    const member = await registerUser(app, { name: 'Олег Читающий' });
    await addMember(app, owner, member.email, 'MEMBER');
    const project = await createProject(app, owner);

    await createIssue(app, owner, project.id, { title: 'Уже видел', assigneeId: member.id });
    await waitForNotifications(member.id, 1);
    const [notification] = await prisma.notification.findMany({ where: { userId: member.id } });
    const read = await app.inject({
      method: 'POST',
      url: `/api/v1/notifications/${notification!.id}/read`,
      headers: { cookie: member.cookie },
    });
    expect(read.statusCode).toBeLessThan(300);

    const box = mailbox();
    const later = new Date(Date.now() + UNREAD_DELAY_MS + MINUTE);
    expect(await sendNotificationDigests(later, box.send)).toBe(0);

    const off = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { cookie: member.cookie },
      payload: { emailNotifications: false },
    });
    expect(off.json().emailNotifications).toBe(false);
    const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: member.cookie } });
    expect(session.json().user.emailNotifications).toBe(false);

    await createIssue(app, owner, project.id, { title: 'Без писем', assigneeId: member.id });
    await waitForNotifications(member.id, 2);
    expect(await sendNotificationDigests(later, box.send)).toBe(0);
    expect(box.letters).toHaveLength(0);
  });
});
