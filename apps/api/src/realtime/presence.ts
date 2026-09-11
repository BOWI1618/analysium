/** Tracks which users currently hold an open realtime stream per workspace. */
export class PresenceRegistry {
  private readonly byWorkspace = new Map<string, Map<string, number>>();

  add(workspaceId: string, userId: string): boolean {
    let users = this.byWorkspace.get(workspaceId);
    if (!users) {
      users = new Map();
      this.byWorkspace.set(workspaceId, users);
    }
    const next = (users.get(userId) ?? 0) + 1;
    users.set(userId, next);
    return next === 1;
  }

  remove(workspaceId: string, userId: string): boolean {
    const users = this.byWorkspace.get(workspaceId);
    if (!users) return false;
    const next = (users.get(userId) ?? 1) - 1;
    if (next <= 0) {
      users.delete(userId);
      if (users.size === 0) this.byWorkspace.delete(workspaceId);
      return true;
    }
    users.set(userId, next);
    return false;
  }

  list(workspaceId: string): string[] {
    return [...(this.byWorkspace.get(workspaceId)?.keys() ?? [])];
  }
}

export const presence = new PresenceRegistry();
