import { useParams } from 'react-router-dom';
import { useSession } from '~/app/session';
import { useIssueByKey } from '~/features/issues/hooks';
import { IssueDetail } from '~/features/issues/IssueDetail';
import { Topbar } from '~/components/Topbar';
import { ErrorState, SkeletonText } from '~/ui/Feedback';

/** Standalone issue route, so an issue link opens correctly from anywhere. */
export function IssuePage() {
  const { issueKey } = useParams();
  const { workspace } = useSession();
  const { data: issue, isLoading, error, refetch } = useIssueByKey(workspace?.id ?? '', issueKey);

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'Проекты', to: '/projects' },
          ...(issue
            ? [
                {
                  label: issue.project.name,
                  to: `/projects/${issue.projectId}`,
                  icon: <span aria-hidden="true">{issue.project.icon}</span>,
                },
                { label: issue.issueKey },
              ]
            : [{ label: issueKey ?? 'Задача' }]),
        ]}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="mx-auto max-w-4xl space-y-4 p-6">
            <SkeletonText lines={2} />
            <SkeletonText lines={8} />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : issue ? (
          <IssueDetail issue={issue} variant="page" />
        ) : null}
      </div>
    </>
  );
}
