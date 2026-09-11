import { useUiStore } from '~/app/uiStore';
import { Drawer } from '~/ui/Drawer';
import { ErrorState, SkeletonText } from '~/ui/Feedback';
import { useIssue } from './hooks';
import { IssueDetail } from './IssueDetail';

/**
 * Global issue side panel. Any list, board or notification can open an issue
 * by id without navigating away, which is what keeps triage fast.
 */
export function IssueDetailPanel() {
  const issueId = useUiStore((s) => s.openIssueId);
  const closeIssue = useUiStore((s) => s.closeIssue);
  const { data: issue, isLoading, error, refetch } = useIssue(issueId);

  return (
    <Drawer open={Boolean(issueId)} onClose={closeIssue} label="Детали задачи">
      {isLoading ? (
        <div className="space-y-4 p-4">
          <SkeletonText lines={2} />
          <SkeletonText lines={6} />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : issue ? (
        <IssueDetail issue={issue} onClose={closeIssue} variant="panel" />
      ) : null}
    </Drawer>
  );
}
