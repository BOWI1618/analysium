import { useUiStore } from '~/app/uiStore';
import { Dialog } from '~/ui/Dialog';
import { ErrorState, SkeletonText } from '~/ui/Feedback';
import { useIssue } from './hooks';
import { IssueDetail } from './IssueDetail';

/**
 * A subtask opened from its parent's list: a window over the parent, like the
 * form a subtask is created in, rather than replacing the parent in the side
 * panel. It moves by its header, so the parent underneath can be read.
 */
export function SubtaskWindow() {
  const issueId = useUiStore((s) => s.openSubtaskId);
  const closeSubtask = useUiStore((s) => s.closeSubtask);
  const { data: issue, isLoading, error, refetch } = useIssue(issueId);

  return (
    <Dialog open={Boolean(issueId)} onClose={closeSubtask} size="xl" draggable bare label="Подзадача">
      <div className="flex h-[min(85vh,52rem)] flex-col">
        {isLoading ? (
          <div className="space-y-4 p-4">
            <SkeletonText lines={2} />
            <SkeletonText lines={6} />
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : issue ? (
          <IssueDetail issue={issue} onClose={closeSubtask} variant="panel" />
        ) : null}
      </div>
    </Dialog>
  );
}
