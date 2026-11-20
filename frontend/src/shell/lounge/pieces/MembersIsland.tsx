/**
 * "Who's around": the community's members in the right region (design §3.4, PR 6), an island at
 * wide and a Sheet below (the template). Hosts (members with a role), Around (online) and Away, from
 * `useCommunityMembers`; each row shows the role as written, the status text, "In <room>" from this
 * community's voice rooms, or when an away member was last seen. "Show more" loads the next page.
 *
 * The header says "N around" only when a source knows the whole community's number
 * (`aroundCount`); otherwise it gives no number. Rows open the existing profile dialog. No
 * moderation action is offered on a row.
 *
 * Performance: rows are memoised and the hook keeps an unchanged member's object, so a presence event
 * re-renders only the rows it touched (Profiler test, `__tests__/shell/pieces/MembersIsland.test.tsx`).
 */
import { memo, useCallback, useContext, useMemo, type JSX } from 'react';
import { Avatar, Button, ListRow, LoadState, Pill, Skeleton, Stack, Text, personColour, useQueryLoadState, useListFocus, type LoadController, type RowFocus } from '../../../kit';
import { useCommunityMembers, type MemberSummary } from '../../../data/members';
import { useAuthenticatedImage } from '../../../hooks/useAuthenticatedImage';
import { UserProfileContext } from '../../../contexts/UserProfileContext';
import { aroundLine } from './community/lines';
import { memberLine } from './memberLines';
import { sameRowFocus } from './sameRowFocus';

export interface MembersIslandProps {
  hosts: readonly MemberSummary[];
  around: readonly MemberSummary[];
  away: readonly MemberSummary[];
  /** Online members in the whole community; null when no source knows it. */
  aroundCount: number | null;
  allLoaded: boolean;
  onLoadMore(): void;
  loadingMore: boolean;
  state: LoadController;
  /** Opens a member's profile; without it the rows only show. */
  onOpenProfile?(id: string): void;
  /** For "Seen 2h ago"; tests and stories pin it. Default: now. */
  now?: number;
}

interface MemberRowProps {
  member: MemberSummary;
  now: number;
  focus: RowFocus;
  onOpen?(id: string): void;
}

function MemberRowView({ member, now, focus, onOpen }: MemberRowProps): JSX.Element {
  const { blobUrl } = useAuthenticatedImage(member.avatarFileId);
  const away = member.presence === 'offline';
  return (
    <ListRow
      size="lg"
      primary={member.name}
      secondary={memberLine(member, now)}
      muted={away}
      leading={
        <Avatar decorative name={member.name} src={blobUrl ?? undefined} colour={personColour(member.id)} presence={away ? 'offline' : 'online'} />
      }
      trailing={member.role ? <Pill size="sm">{member.role}</Pill> : undefined}
      trailingLabel={[member.role, away ? 'away' : 'online'].filter(Boolean).join(', ')}
      onClick={onOpen ? () => onOpen(member.id) : undefined}
      focus={focus}
    />
  );
}

/** Re-renders only when its member, its tab stop or the clock changed. Exported for the render-count test. */
export const MemberRow = memo(
  MemberRowView,
  (a, b) => a.member === b.member && a.now === b.now && a.onOpen === b.onOpen && sameRowFocus(a.focus, b.focus),
);

function MembersSkeleton(): JSX.Element {
  return (
    <Stack gap="sm">
      {Array.from({ length: 8 }, (_, i) => (
        <Stack key={i} direction="row" gap="sm">
          <Skeleton shape="circle" size="md" />
          <Stack gap="xs" fill>
            <Skeleton shape="text" lines={2} />
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

const GROUPS = [
  { key: 'hosts', title: 'Hosts' },
  { key: 'around', title: 'Around' },
  { key: 'away', title: 'Away' },
] as const;

export function MembersIsland({
  hosts,
  around,
  away,
  aroundCount,
  allLoaded,
  onLoadMore,
  loadingMore,
  state,
  onOpenProfile,
  now = Date.now(),
}: MembersIslandProps): JSX.Element {
  const groups = { hosts, around, away };
  const rows = useMemo(
    () => [...hosts, ...around, ...away].map((member) => ({ id: member.id, label: member.name, disabled: false })),
    [hosts, around, away],
  );
  const list = useListFocus({ rows, selected: null });
  const line = aroundLine(aroundCount);
  // One minute is enough for "Seen 2h ago": rows do not re-render on every parent render.
  const minute = Math.floor(now / 60_000) * 60_000;

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Text variant="title" as="h2">
          Who's around
        </Text>
        {line !== null && (
          <Text variant="meta" tone="secondary">
            {line}
          </Text>
        )}
      </Stack>
      <LoadState
        state={state}
        label="Members"
        skeleton={<MembersSkeleton />}
        empty={
          <Text variant="meta" tone="secondary" as="p">
            No members yet. People show here once they join.
          </Text>
        }
        errorTitle="Couldn't load members"
      >
        <Stack gap="lg">
          <div {...list.listProps}>
            <Stack gap="lg">
            {GROUPS.map(({ key, title }) =>
              groups[key].length === 0 ? null : (
                <Stack key={key} gap="xs">
                  <Text variant="section" tone="secondary" as="h3">
                    {title}
                  </Text>
                  {groups[key].map((member) => (
                    <MemberRow key={member.id} member={member} now={minute} focus={list.rowFocus(member.id)} onOpen={onOpenProfile} />
                  ))}
                </Stack>
              ),
            )}
            </Stack>
          </div>
          {!allLoaded && (
            <div>
              <Button onClick={onLoadMore} loading={loadingMore}>
                Show more
              </Button>
            </div>
          )}
        </Stack>
      </LoadState>
    </Stack>
  );
}

/** The membership pages hold nobody (the envelope or the pre-0.4.0 plain array). */
function noMemberships(data: unknown): boolean {
  const pages = (data as { pages?: unknown[] } | undefined)?.pages ?? [];
  return pages.every((page) => (Array.isArray(page) ? page : ((page as { members?: unknown[] })?.members ?? [])).length === 0);
}

export interface MembersIslandConnectedProps {
  communityId: string;
}

export function MembersIslandConnected({ communityId }: MembersIslandConnectedProps): JSX.Element {
  const members = useCommunityMembers(communityId);
  const profile = useContext(UserProfileContext);
  const openProfile = profile?.openProfile;
  const onOpenProfile = useCallback((id: string) => openProfile?.(id), [openProfile]);
  // Loaded rows stay through a failed refetch (a toast says so); the error face shows only with nothing to show.
  const state = useQueryLoadState(members.pagesQuery, {
    notifyId: 'lounge-members',
    resetKey: communityId,
    isEmpty: noMemberships,
  });
  return (
    <MembersIsland
      hosts={members.hosts}
      around={members.around}
      away={members.away}
      aroundCount={members.aroundCount}
      allLoaded={members.allLoaded}
      onLoadMore={members.loadMore}
      loadingMore={members.loadingMore}
      state={state}
      onOpenProfile={openProfile ? onOpenProfile : undefined}
    />
  );
}
