import { useSession } from '~/app/session';
import { Topbar } from '~/components/Topbar';
import { NotificationList } from '~/components/NotificationCenter';

/** Full-page notification centre — the same list as the bell, with more room. */
export function InboxPage() {
  const { workspace } = useSession();

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Входящие' }]} />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl p-4">
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <NotificationList workspaceId={workspace?.id ?? ''} maxHeight="max-h-none" />
          </div>
        </div>
      </div>
    </>
  );
}
