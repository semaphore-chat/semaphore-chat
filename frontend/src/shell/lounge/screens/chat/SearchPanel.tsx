/**
 * Message search in the new shell's chat at compact and wide (design §3 PR 10e, B9): the screen's right panel, in the
 * members' place at wide and the filling right Sheet at compact (a phone keeps the old search screen). On the shared
 * `useMessageSearch` (the old popover's and the phone screen's query): this channel or all of the community's, the
 * text debounced as the old search does. Choosing a result jumps to it (`?highlight=`) and keeps the panel open, as the
 * old docked panel, so several results can be stepped through; a result in another channel opens that channel with the
 * panel still open (its text and scope live above the chat, `SearchMemory`), focus back on the result.
 *
 * Keys: ↓ from the field goes to the results, ↑/↓ move through them, Enter opens one (Enter in the field opens the
 * first); Escape is the frame's (closes the panel, focus back to More).
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Avatar,
  Button,
  IconButton,
  ListRow,
  PanelPane,
  Skeleton,
  Stack,
  Tabs,
  Text,
  TextField,
  personColour,
  useAnnounce,
  useListFocus,
  type RowFocus,
} from '../../../../kit';
import { userControllerGetUserByIdOptions } from '../../../../api-client/@tanstack/react-query.gen';
import { useDebounce } from '../../../../hooks/useDebounce';
import { SearchScope, useMessageSearch, type SearchResult } from '../../../../hooks/useMessageSearch';
import { stripBidiOverrides } from '../../../../utils/bidi';
import { formatMessageTime } from '../../../../utils/messageTime';

/** As the old search box: the query runs once typing pauses this long. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * What the search remembers while it is open, above the chat (a jump to another channel starts a new chat): the text,
 * the scope, and where focus goes the next time the panel mounts: the field (just opened), a result (back after a jump
 * to another channel, or after a thread over it), or nowhere (another channel chosen from the list keeps focus there).
 */
export interface SearchMemory {
  query: string;
  scope: SearchScope;
  focus: 'field' | { result: string } | null;
}

export function freshSearchMemory(): SearchMemory {
  return { query: '', scope: SearchScope.Channel, focus: null };
}

export interface SearchPanelProps {
  communityId: string;
  channelId: string;
  memory: SearchMemory;
  onClose: () => void;
  /** A result was chosen; the panel stays open. */
  onJump: (result: SearchResult) => void;
}

const SCOPE_TABS = [
  { id: SearchScope.Channel, label: 'This channel' },
  { id: SearchScope.Community, label: 'All channels' },
];

/** A result's words on one line, as the old list shows them. */
export function resultText(result: Pick<SearchResult, 'spans'>): string {
  return result.spans
    .filter((span) => span.text)
    .map((span) => stripBidiOverrides(span.text ?? ''))
    .join(' ');
}

function ResultRow({
  result,
  community,
  focus,
  rowRef,
  onChoose,
}: {
  result: SearchResult;
  community: boolean;
  focus: RowFocus;
  rowRef: (element: HTMLElement | null) => void;
  onChoose: () => void;
}): JSX.Element {
  const authorId = result.authorId;
  const { data: user } = useQuery({
    ...userControllerGetUserByIdOptions({ path: { id: authorId ?? '' } }),
    enabled: !!authorId && !result.webhook,
    staleTime: 5 * 60 * 1000,
  });
  const name = result.webhook?.name ?? (user?.displayName || user?.username || (authorId ? '…' : 'Deleted user'));
  const where = community && result.channelName ? ` · #${result.channelName}` : '';
  const words = resultText(result) || (result.attachments.length > 0 ? 'Files' : 'No text');
  return (
    <ListRow
      ref={rowRef}
      focus={focus}
      size="lg"
      primary={`${name}${where} · ${formatMessageTime(result.sentAt)}`}
      secondary={words}
      leading={<Avatar name={name} colour={authorId && !result.webhook ? personColour(authorId) : undefined} size="md" decorative />}
      label={`Show the message from ${name}${where ? ` in #${result.channelName}` : ''}: ${words}`}
      onClick={onChoose}
    />
  );
}

function resultsAnnouncement(count: number, scope: SearchScope): string {
  if (count === 0) return 'No messages found';
  const where = scope === SearchScope.Channel ? 'in this channel' : 'in all channels';
  return count === 1 ? `1 message found ${where}` : `${count} messages found ${where}`;
}

export function SearchPanel({ communityId, channelId, memory, onClose, onJump }: SearchPanelProps): JSX.Element {
  const [query, setQueryState] = useState(memory.query);
  const [scope, setScopeState] = useState(memory.scope);
  const setQuery = (value: string) => {
    memory.query = value;
    setQueryState(value);
  };
  const setScope = (value: SearchScope) => {
    memory.scope = value;
    setScopeState(value);
  };
  const debounced = useDebounce(query, SEARCH_DEBOUNCE_MS);
  const { results, isLoading, isError, refetch } = useMessageSearch({ channelId, communityId, query: debounced, scope });
  const searched = debounced.trim();
  const pending = query.trim() !== searched;

  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const listRows = useMemo(() => results.map((result) => ({ id: result.id, label: resultText(result), disabled: false })), [results]);
  // Arrows only: a row is a button, and its own click (a press, Enter, Space) opens the result.
  const list = useListFocus({ rows: listRows, selected: null, typeahead: false });

  // Where focus goes once on mount (`SearchMemory.focus`): the field, or the result last opened once it is in the list
  // again (the results come from the cache). Consumed, so a later remount leaves focus where the user is.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current) return;
    const want = memory.focus;
    if (want !== null && want !== 'field' && isLoading) return;
    placed.current = true;
    memory.focus = null;
    if (want === null) return;
    const row = want === 'field' ? undefined : rows.current.get(want.result);
    // Not cancelled by a re-render (the results arriving): only an element that is still on the page takes it.
    requestAnimationFrame(() => {
      const target = row ?? field.current;
      if (target?.isConnected) target.focus({ preventScroll: false });
    });
  }, [isLoading, results, memory]);

  // The outcome is said politely once a search settles.
  const announce = useAnnounce();
  useEffect(() => {
    if (searched === '' || pending || isLoading || isError) return;
    announce(resultsAnnouncement(results.length, scope));
  }, [announce, searched, pending, isLoading, isError, results.length, scope]);

  const choose = (result: SearchResult) => onJump(result);

  const body =
    searched === '' ? (
      <Text variant="small" tone="secondary">
        {scope === SearchScope.Channel ? 'Search the messages in this channel.' : 'Search the messages in every channel of this community.'}
      </Text>
    ) : isLoading ? (
      <Stack gap="md">
        <span role="status">
          <Text variant="small" tone="secondary">
            Searching
          </Text>
        </span>
        {Array.from({ length: 3 }, (_, i) => (
          <Stack key={i} direction="row" gap="md">
            <Skeleton shape="circle" size="md" />
            <Stack gap="xs" fill>
              <Skeleton shape="text" lines={2} />
            </Stack>
          </Stack>
        ))}
      </Stack>
    ) : isError ? (
      <Stack gap="sm" align="start">
        <Text>Couldn&apos;t search messages</Text>
        <Button onClick={() => void refetch()}>Try again</Button>
      </Stack>
    ) : results.length === 0 ? (
      <Stack gap="sm" align="start">
        <Text>No messages found</Text>
        {scope === SearchScope.Channel && (
          <Button variant="soft" onClick={() => setScope(SearchScope.Community)}>
            Search all channels
          </Button>
        )}
      </Stack>
    ) : (
      <div role="list" aria-label="Search results" {...list.listProps}>
        {results.map((result) => (
          <div role="listitem" key={result.id}>
            <ResultRow
              result={result}
              community={scope === SearchScope.Community}
              focus={list.rowFocus(result.id)}
              rowRef={(element) => {
                if (element) rows.current.set(result.id, element);
                else rows.current.delete(result.id);
              }}
              onChoose={() => choose(result)}
            />
          </div>
        ))}
      </div>
    );

  return (
    <PanelPane
      header={
        <Stack direction="row" gap="sm">
          <Stack direction="row" gap="xs" fill>
            <Text variant="title" as="h2" truncate>
              Search messages
            </Text>
          </Stack>
          <IconButton icon="X" label="Close search" variant="ghost" onClick={onClose} />
        </Stack>
      }
      top={
        <Stack gap="sm">
          <TextField
            ref={field}
            label="Search messages"
            labelHidden
            type="search"
            shape="round"
            startIcon="Search"
            placeholder={scope === SearchScope.Channel ? 'Search this channel' : 'Search all channels'}
            value={query}
            onChange={setQuery}
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && results.length > 0 && !pending) {
                event.preventDefault();
                rows.current.get(results[0].id)?.focus();
              } else if (event.key === 'Enter' && results.length > 0 && !pending) {
                event.preventDefault();
                choose(results[0]);
              }
            }}
          />
          <Tabs
            label="Search in"
            variant="segmented"
            fullWidth
            tabs={SCOPE_TABS}
            value={scope}
            onChange={(id) => setScope(id as SearchScope)}
          />
        </Stack>
      }
    >
      {body}
    </PanelPane>
  );
}
