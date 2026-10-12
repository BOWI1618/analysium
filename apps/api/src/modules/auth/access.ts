/**
 * Who may get in, and who lets them.
 *
 * The installation is closed. Nobody signs up on their own: a person gets in
 * by a link that the owner of a workspace made for them, and only an owner
 * makes such links. The one exception is the very first account — somebody
 * has to be first, and that person becomes the owner.
 */
import { WorkspaceRole, type ActorContext } from '@flowdesk/contracts';
import { env, isProd } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { forbidden } from '../../lib/errors';

/**
 * Sign-up without an invitation is a convenience of development: the demo and
 * the test suites make accounts by the dozen. In production the switch is not
 * read at all, so a line left behind in an .env file cannot open the door.
 */
export function signUpIsOpen(): boolean {
  return !isProd && env.ALLOW_PUBLIC_REGISTRATION;
}

/** Whether the sign-up form works right now: only while nobody has an account yet. */
export async function registrationOpen(): Promise<boolean> {
  if (signUpIsOpen()) return true;
  return (await prisma.user.count()) === 0;
}

/** Access to a workspace is given by its owner and by nobody else. */
export function assertGrantsAccess(actor: ActorContext): void {
  if (actor.workspaceRole !== WorkspaceRole.OWNER) {
    throw forbidden('Доступ в пространство выдаёт только его владелец');
  }
}

/**
 * A workspace of one's own is a place to let people into. So once sign-up is
 * closed, only someone who already owns a workspace may start another:
 * otherwise anyone let in could open a side door for others.
 */
export async function assertMayCreateWorkspace(userId: string): Promise<void> {
  if (signUpIsOpen()) return;
  const owned = await prisma.workspace.count({ where: { ownerId: userId } });
  if (owned === 0) throw forbidden('Новое пространство может создать только владелец');
}
