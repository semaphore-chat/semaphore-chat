/**
 * The community switcher in the frame's dock slot (design §3.1): the Inbox, every community the server
 * lists for this user (a mention count, or the new-messages dot), and "All communities", which opens the
 * sheet. One keyboard list (`useListFocus`, horizontal): a single Tab stop, Left/Right/Home/End and
 * typeahead. Each community is a link to its route (a hash link: the router's transition applies). On a
 * phone the Dock is the bottom bar; at compact and wide it sits above the left island (ThreeIslands).
 *
 * `ShellDock` is the view (closed props, stories); `ShellDockConnected` reads `src/data`.
 */
import { useCallback, useEffect, useMemo, type JSX } from 'react';
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

/** The ref callback that marks a dock item for RouteFocus's remembered row (DockItem takes no data attributes). */
function markRow(id: string) {
  return (element: HTMLElement | null) => {
    element?.setAttribute(LOUNGE_ROW_ATTRIBUTE, dockRowId(id));
  };
}

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
  const rows = useMemo(
    () => [
      { id: INBOX_ROW, label: 'Inbox', disabled: false },
      ...shown.map((community) => ({ id: community.id, label: community.name, disabled: false })),
      { id: ALL_ROW, label: ALL_LABEL, disabled: false },
    ],
    [shown],
  );
  const currentId = current === null ? null : current.kind === 'inbox' ? INBOX_ROW : current.id;
  const list = useListFocus({ rows, selected: currentId, orientation: 'horizontal', onSelect: onActivate });
  const refs = useMemo(() => new Map(shown.map((community) => [community.id, markRow(community.id)])), [shown]);

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
        <DockItem
          key={community.id}
          ref={refs.get(community.id)}
          name={community.name}
          src={community.src}
          href={`#/community/${community.id}`}
          current={current?.kind === 'community' && current.id === community.id}
          unread={community.mentions}
          unreadLabel="mentions"
          newMessages={community.newMessages}
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
  const { communities, status, refetch } = useMyCommunities();
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
  const failed = status === 'error' && communities.length === 0;
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
