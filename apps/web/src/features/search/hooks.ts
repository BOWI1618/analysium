import { useQuery } from '@tanstack/react-query';
import type { SearchResultsDto } from '@flowdesk/contracts';
import { api } from '~/lib/api';
import { qk } from '~/lib/queryKeys';
import { useDebounce } from '~/lib/hooks/useDebounce';

/** Debounced global search — one request per pause, not per keystroke. */
export function useSearch(workspaceId: string, term: string, enabled = true) {
  const debounced = useDebounce(term.trim(), 200);

  const query = useQuery({
    queryKey: qk.search(workspaceId, debounced),
    queryFn: ({ signal }) =>
      api.get<SearchResultsDto>(`/workspaces/${workspaceId}/search`, {
        query: { q: debounced, limit: 8 },
        signal,
      }),
    enabled: enabled && debounced.length >= 1 && Boolean(workspaceId),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  return { ...query, term: debounced, isTyping: term.trim() !== debounced };
}
