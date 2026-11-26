import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ListChecks, PanelRightOpen } from 'lucide-react';
import type { IssueSummaryDto } from '@flowdesk/contracts';
import { useToast } from '~/app/toast';
import { useUiStore } from '~/app/uiStore';
import { useSearch } from '~/features/search/hooks';
import { Button } from '~/ui/Button';
import { Input } from '~/ui/Input';
import { Popover } from '~/ui/Popover';
import { issueByKeyQuery } from './hooks';

function taskKeyFromLink(href: string) {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const key = /^\/issue\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (key) return decodeURIComponent(key);
  } catch {
    return;
  }
}

export function useOpenRichTextTaskLink(workspaceId?: string, preview?: (id: string) => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const openIssue = useUiStore((state) => state.openIssue);
  return (href: string) => {
    const key = taskKeyFromLink(href);
    if (!workspaceId || !key) return false;
    void queryClient.fetchQuery(issueByKeyQuery(workspaceId, key)).then(
      (issue) => (preview ?? openIssue)(issue.id),
      (error: unknown) => toast.error(error, 'Не удалось открыть задачу'),
    );
    return true;
  };
}

export function TaskLinkPicker({ workspaceId, insert, preview }: {
  workspaceId: string;
  insert: (label: string, href: string) => void;
  preview?: (id: string) => void;
}) {
  const openIssue = useUiStore((state) => state.openIssue);
  return (
    <Popover
      label="Ссылка на задачу"
      width={280}
      trigger={({ open, toggle }) => (
        <Button variant="ghost" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={toggle} aria-expanded={open}>
          <ListChecks className="size-3.5" /> Ссылка на задачу
        </Button>
      )}
    >
      {({ close }) => (
        <TaskLinkResults
          workspaceId={workspaceId}
          select={(issue) => {
            close();
            insert(issue.title, `/issue/${encodeURIComponent(issue.issueKey)}`);
          }}
          preview={(id) => {
            close();
            (preview ?? openIssue)(id);
          }}
        />
      )}
    </Popover>
  );
}

function TaskLinkResults({ workspaceId, select, preview }: {
  workspaceId: string;
  select: (issue: IssueSummaryDto) => void;
  preview: (id: string) => void;
}) {
  const [term, setTerm] = useState('');
  const search = useSearch(workspaceId, term);
  const results = search.isTyping ? [] : search.data?.issues ?? [];

  return (
    <div className="space-y-2">
      <Input autoFocus label="Поиск задачи" placeholder="Номер или название" value={term} onChange={(event) => setTerm(event.target.value)} />
      {term.trim() && (
        <ul className="max-h-48 overflow-y-auto">
          {search.isError ? <li className="px-1 text-xs text-danger">Не удалось найти задачи</li> :
            search.isFetching || search.isTyping ? <li className="px-1 text-xs text-text-muted">Ищем…</li> :
              results.length === 0 ? <li className="px-1 text-xs text-text-muted">Задачи не найдены</li> :
                results.map((issue) => (
                  <li key={issue.id} className="flex items-center gap-1">
                    <button type="button" title={issue.title} onClick={() => select(issue)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs hover:bg-surface-hover">
                      {issue.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Открыть карточку: ${issue.title}`}
                      title="Открыть карточку"
                      onClick={() => preview(issue.id)}
                      className="shrink-0 p-1.5 text-text-muted hover:bg-surface-hover hover:text-text"
                    >
                      <PanelRightOpen className="size-3.5" />
                    </button>
                  </li>
                ))}
        </ul>
      )}
    </div>
  );
}
