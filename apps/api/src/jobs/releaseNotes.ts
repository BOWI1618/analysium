import { NotificationType } from '@flowdesk/contracts';
import { prisma } from '../lib/prisma';
import { log } from '../lib/logger';
import { RELEASES, releaseBody, type Release } from '../domain/releases';
import { notify } from '../modules/notifications/service';

/**
 * Tells everyone what the update they are now using brought. Runs once at
 * start-up: a deploy restarts the server, so the newest release is announced
 * right after it ships. Only the newest — a fresh install should not open
 * with a pile of old news.
 *
 * Marked per workspace by the notification's key, so a restart announces
 * nothing twice, and a start that failed halfway finishes the rest next time.
 */
export async function announceLatestRelease(release: Release | undefined = RELEASES[0]): Promise<number> {
  if (!release) return 0;
  const key = `release:${release.id}`;

  const members = await prisma.workspaceMember.findMany({
    where: { user: { status: 'ACTIVE' } },
    select: { workspaceId: true, userId: true },
  });
  const byWorkspace = new Map<string, string[]>();
  for (const m of members) byWorkspace.set(m.workspaceId, [...(byWorkspace.get(m.workspaceId) ?? []), m.userId]);

  let announced = 0;
  for (const [workspaceId, userIds] of byWorkspace) {
    const done = await prisma.notification.findFirst({
      where: { workspaceId, type: NotificationType.RELEASE_NOTES, reminderKey: key },
      select: { id: true },
    });
    if (done) continue;
    await notify({
      userIds,
      workspaceId,
      actorId: null,
      type: NotificationType.RELEASE_NOTES,
      title: release.title,
      body: releaseBody(release),
      reminderKey: key,
    });
    announced += 1;
  }
  return announced;
}

export function startReleaseNotes(): void {
  void announceLatestRelease()
    .then((count) => {
      if (count > 0) log.info({ workspaces: count }, 'release notes announced');
    })
    .catch((error) => log.warn({ err: error }, 'release notes failed'));
}
