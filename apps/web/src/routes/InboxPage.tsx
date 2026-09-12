import { useSession } from '~/app/session';
import { Topbar } from '~/components/Topbar';
import { NotificationList } from '~/components/NotificationCenter';
import { Marker, Masthead } from '~/ui/Masthead';

/** Full-page notification centre — the same list as the bell, with more room. */
export function InboxPage() {
  const { workspace } = useSession();

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Входящие' }]} />
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg scrollbar-thin">
        <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
          <Masthead
            kicker={workspace?.name}
            title={
              <>
                <Marker>Входящие</Marker>
              </>
            }
            note="Всё, что касается вас: упоминания, назначения и сроки."
          />
          <div className="border-2 border-border-strong bg-surface shadow-lg">
            <NotificationList workspaceId={workspace?.id ?? ''} maxHeight="max-h-none" />
          </div>
        </div>
      </div>
    </>
  );
}
