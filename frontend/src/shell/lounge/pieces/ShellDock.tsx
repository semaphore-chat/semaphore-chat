/**
 * The community switcher in the frame's dock slot (design §3.1): the Inbox, every community the server
 * lists for this user (a mention count, or the new-messages dot), and "All communities", which opens the
 * sheet. One keyboard list (`useListFocus`, horizontal): a single Tab stop, Left/Right/Home/End and
 * typeahead. Each community is a link to its route (a hash link: the router's transition applies). On a
 * phone the Dock is the bottom bar; at compact and wide it sits above the left island (ThreeIslands).
 *
 * `ShellDock` is the view (closed props, stories); `ShellDockConnected` reads `src/data`.
 */
import { memo, useCallback, useEffect, useMemo, type JSX } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Dock,
  DockDivider,
  DockItem,
  IconButton,
  Skeleton,
  useListFocus,
  useToasts,
  useWidthRange,
  type RowFocus,
} from '../../../kit';
import { useMyCommunities } from '../../../data/myCommunities';
import { useUnreadSummary } from '../../../data/unread';
import { LOUNGE_ROW_ATTRIBUTE, rememberActivatedRow } from '../frame/routeMemory';
import { CommunityPictureProbes } from './communityPictures';
import { useCommunityPictures } from './useCommunityPictures';
import { ALL_LABEL, ALL_ROW, DOCK_LABEL, INBOX_ROW, dockRowId } from './communitiesModel';

/** What the dock marks as current, from the route's params (no `useParams` in pieces). */
export type DockCurrent = { kind: 'community'; id: string } | { kind: 'inbox' } | null;

export interface DockCommunity {
  id: string;
  name: string;
  src?: string;
  /** Mentions in the community's channels: the count on the item. */
  mentions: number;
  /** Unread messages that do not mention the user: the dot (the count wins). */
  newMessages: boolean;
}

export type DockStatus = 'loading' | 'error' | 'ready';

export interface ShellDockProps {
  communities: readonly DockCommunity[];
  current: DockCurrent;
  /** DM unread + channel mentions (design PA-6). */
  inboxCount: number;
  status: DockStatus;
  onOpenInbox(): void;
  onOpenAll(): void;
  /** The sheet is showing (the All button's `aria-expanded`). */
  allOpen?: boolean;
  /** A phone: the Dock is the bottom edge of the screen. */
  bottomBar: boolean;
  /** An item was chosen (Enter, Space or a click), with its row id: `inbox`, `all` or a community id. */
  onActivate?(id: string): void;
}

const NONE: readonly DockCommunity[] = [];
/** How many placeholder circles stand for the communities while they load. */
const SKELETONS = 3;

/**
 * The ref callback that marks a dock item for RouteFocus's remembered row (DockItem takes no data attributes). One
 * per id for the app's life, so an item's ref never changes and is never detached and attached again.
 */
const markers = new Map<string, (element: HTMLElement | null) => void>();
function markRow(id: string): (element: HTMLElement | null) => void {
  let marker = markers.get(id);
  if (marker === undefined) {
    marker = (element) => element?.setAttribute(LOUNGE_ROW_ATTRIBUTE, dockRowId(id));
    markers.set(id, marker);
  }
  return marker;
}

interface CommunityItemProps {
  id: string;
  name: string;
  src: string | undefined;
  mentions: number;
  newMessages: boolean;
  current: boolean;
  focus: RowFocus;
}

/** Shallow equality of two plain objects (the list's opaque `focus` holds a tab index and two per-id callbacks). */
function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.is(left[key], right[key]));
}

/**
 * One community on the dock, memoised: a change to one community's counts re-renders that item only (the list's
 * `focus` is a new object each render with the same contents, so it is compared by contents).
 */
const CommunityItem = memo(
  function CommunityItem({ id, name, src, mentions, newMessages, current, focus }: CommunityItemProps): JSX.Element {
    return (
      <DockItem
        ref={markRow(id)}
        name={name}
        src={src}
        href={`#/community/${id}`}
        current={current}
        unread={mentions}
        unreadLabel="mentions"
        newMessages={newMessages}
        focus={focus}
      />
    );
  },
  (previous, next) => {
    const { focus: previousFocus, ...previousRest } = previous;
    const { focus: nextFocus, ...nextRest } = next;
    return shallowEqual(previousRest, nextRest) && shallowEqual(previousFocus, nextFocus);
  },
);

export function ShellDock({
  communities,
  current,
  inboxCount,
  status,
  onOpenInbox,
  onOpenAll,
  allOpen = false,
  bottomBar,
  onActivate,
}: ShellDockProps): JSX.Element {
  const shown = status === 'ready' ? communities : NONE;
  // The rows change only when the ids or names do, not on every count change.
  const rowKey = shown.map((community) => `${community.id}\u0000${community.name}`).join('\u0001');
  const rows = useMemo(
    () => [
      { id: INBOX_ROW, label: 'Inbox', disabled: false },
      ...shown.map((community) => ({ id: community.id, label: community.name, disabled: false })),
      { id: ALL_ROW, label: ALL_LABEL, disabled: false },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowKey stands for the ids and names of `shown`
    [rowKey],
  );
  const currentId = current === null ? null : current.kind === 'inbox' ? INBOX_ROW : current.id;
  const list = useListFocus({ rows, selected: currentId, orientation: 'horizontal', onSelect: onActivate });

  const hasItems = shown.length > 0 || status === 'loading';
  return (
    <Dock
      label={DOCK_LABEL}
      bottomBar={bottomBar}
      focus={list.bar}
      start={
        <>
          <IconButton
            icon="Inbox"
            variant="primary"
            label="Inbox"
            badge={inboxCount}
            current={current?.kind === 'inbox'}
            onClick={onOpenInbox}
            focus={list.rowFocus(INBOX_ROW)}
          />
          {hasItems && <DockDivider />}
        </>
      }
      end={
        <>
          {hasItems && <DockDivider />}
          <IconButton
            icon="LayoutGrid"
            variant="soft"
            label={ALL_LABEL}
            aria-haspopup="dialog"
            aria-expanded={allOpen}
            onClick={onOpenAll}
            focus={list.rowFocus(ALL_ROW)}
          />
        </>
      }
    >
      {status === 'loading' &&
        Array.from({ length: SKELETONS }, (_, index) => <Skeleton key={index} shape="circle" size="md" />)}
      {shown.map((community) => (
        <CommunityItem
          key={community.id}
          id={community.id}
          name={community.name}
          src={community.src}
          mentions={community.mentions}
          newMessages={community.newMessages}
          current={current?.kind === 'community' && current.id === community.id}
          focus={list.rowFocus(community.id)}
        />
      ))}
    </Dock>
  );
}

export interface ShellDockConnectedProps {
  current: DockCurrent;
  /** Opens the "All communities" sheet, whose state is the frame's. */
  onOpenAll(): void;
  /** The sheet is showing. */
  allOpen?: boolean;
}

const LOAD_ERROR_TOAST = 'dock-communities';

/** The dock from the server's list and the one unread query. */
export function ShellDockConnected({ current, onOpenAll, allOpen = false }: ShellDockConnectedProps): JSX.Element {
  const { communities, status, refetch, query } = useMyCommunities();
  const unread = useUnreadSummary();
  const range = useWidthRange();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toasts = useToasts();
  const { pictures, onUrl } = useCommunityPictures();

  const items = useMemo<DockCommunity[]>(
    () =>
      communities.map((community) => {
        const counts = unread.community(community.id);
        return {
          id: community.id,
          name: community.name,
          src: pictures.get(community.id),
          mentions: counts.mentions,
          newMessages: counts.hasUnread && counts.mentions === 0,
        };
      }),
    [communities, unread, pictures],
  );

  // A first load that failed: the dock keeps Inbox and All, and a toast offers to try again.
  // Not "no communities": a user in none whose background refetch fails still has a loaded (empty) list.
  const failed = status === 'error' && query.data === undefined;
  useEffect(() => {
    if (!failed) return undefined;
    toasts.show({
      id: LOAD_ERROR_TOAST,
      tone: 'danger',
      message: "Couldn't load your communities",
      action: { label: 'Try again', onAction: refetch },
    });
    return () => toasts.dismiss(LOAD_ERROR_TOAST);
  }, [failed, toasts, refetch]);

  const onActivate = useCallback(
    (id: string) => {
      if (id !== INBOX_ROW && id !== ALL_ROW) rememberActivatedRow(pathname, dockRowId(id));
    },
    [pathname],
  );

  return (
    <>
      <CommunityPictureProbes communities={communities} onUrl={onUrl} />
      <ShellDock
        communities={items}
        current={current}
        inboxCount={unread.inbox.total}
        status={status === 'pending' ? 'loading' : failed ? 'error' : 'ready'}
        onOpenInbox={() => navigate('/direct-messages')}
        onOpenAll={onOpenAll}
        allOpen={allOpen}
        bottomBar={range === 'phone'}
        onActivate={onActivate}
      />
    </>
  );
}
