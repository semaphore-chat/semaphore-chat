/**
 * The "All communities" sheet the dock's All button opens (design §3.2): the instance heading, every
 * community the server lists for this user as a row with its state line, a filter field above 8
 * communities, "Create a community" when the user may, and on a phone Settings and Your profile at the
 * foot (PA-10: a phone Lounge screen has no user card and no navigation). One keyboard list over the rows
 * (`useListFocus`, vertical, typeahead). Loading, empty and error through `LoadState`.
 *
 * `AllCommunitiesSheet` is the view (closed props, stories); `AllCommunitiesSheetConnected` reads
 * `src/data`. The frame holds `open`.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Icon,
  ListRow,
  LoadState,
  Sheet,
  Skeleton,
  Stack,
  Text,
  TextField,
  useListFocus,
  useQueryLoadState,
  useWidthRange,
  type LoadController,
  type SheetCloseReason,
} from '../../../kit';
import {
  toCommunitySummaries,
  useCallCommunityId,
  useCanCreateCommunity,
  useInstanceIdentity,
  useMyCommunities,
} from '../../../data/myCommunities';
import { useUnreadSummary } from '../../../data/unread';
import { rememberActivatedRow } from '../frame/routeMemory';
import { CommunityPictureProbes } from './communityPictures';
import { useCommunityPictures } from './useCommunityPictures';
import {
  FILTER_THRESHOLD,
  FOOT_ROWS,
  SHEET_TITLE,
  dockRowId,
  isFootRow,
  matchesFilter,
  mentionText,
  stateLine,
} from './communitiesModel';

const CREATE_PATH = '#/community/create';
const SETTINGS_PATH = '#/settings';
const PROFILE_PATH = '#/profile';

export interface SheetCommunity {
  id: string;
  name: string;
  src?: string;
  mentions: number;
  newMessages: boolean;
  /** The user's call is in this community. */
  inYourCall: boolean;
}

export interface AllCommunitiesSheetProps {
  open: boolean;
  onClose(reason: SheetCloseReason): void;
  instanceName: string;
  username: string | null;
  communities: readonly SheetCommunity[];
  currentId: string | null;
  canCreate: boolean;
  /**
   * The list's load state (kit `useLoadState` / `useQueryLoadState`). A hook, called while the sheet is
   * open only, so a background refresh that fails while it is closed raises no toast.
   */
  useLoad(): LoadController;
  /** The filter field's text (the field shows above `FILTER_THRESHOLD` communities). */
  filter: string;
  onFilterChange(value: string): void;
  /** A phone: Settings and Your profile at the foot. */
  showSettings: boolean;
  /** A row was chosen (its link has already navigated), with its row id: a community id or a `FOOT_ROWS` id. */
  onActivate?(id: string): void;
}

type BodyProps = Omit<AllCommunitiesSheetProps, 'open' | 'onClose' | 'instanceName' | 'username'>;

const ROW_SKELETONS = 4;

function Body({
  communities,
  currentId,
  canCreate,
  useLoad,
  filter,
  onFilterChange,
  showSettings,
  onActivate,
}: BodyProps): JSX.Element {
  const load = useLoad();
  const filtering = communities.length > FILTER_THRESHOLD;
  const shown = useMemo(
    () => (filtering ? communities.filter((community) => matchesFilter(community.name, filter)) : communities),
    [communities, filter, filtering],
  );
  const foot = useMemo(
    () => [
      ...(canCreate ? [{ id: FOOT_ROWS.create, label: 'Create a community', disabled: false }] : []),
      ...(showSettings
        ? [
            { id: FOOT_ROWS.settings, label: 'Settings', disabled: false },
            { id: FOOT_ROWS.profile, label: 'Your profile', disabled: false },
          ]
        : []),
    ],
    [canCreate, showSettings],
  );
  const rows = useMemo(
    () => [...shown.map((community) => ({ id: community.id, label: community.name, disabled: false })), ...foot],
    [shown, foot],
  );
  const list = useListFocus({ rows, selected: currentId, onSelect: onActivate });

  // Opened with many communities: the current one's row is scrolled into view inside the sheet's body, once,
  // when the list first shows (a later refresh leaves the user's scroll alone).
  const listRef = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  const ready = load.status === 'ready' || load.status === 'refreshing';
  useLayoutEffect(() => {
    if (revealed.current || !ready) return;
    revealed.current = true;
    const row = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    row?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, [ready]);

  const footRows = (
    <>
      {canCreate && (
        <ListRow
          primary="Create a community"
          leading={<Icon name="Plus" />}
          href={CREATE_PATH}
          focus={list.rowFocus(FOOT_ROWS.create)}
        />
      )}
      {showSettings && (
        <>
          <ListRow
            primary="Settings"
            leading={<Icon name="Settings" />}
            href={SETTINGS_PATH}
            focus={list.rowFocus(FOOT_ROWS.settings)}
          />
          <ListRow
            primary="Your profile"
            leading={<Icon name="User" />}
            href={PROFILE_PATH}
            focus={list.rowFocus(FOOT_ROWS.profile)}
          />
        </>
      )}
    </>
  );

  return (
    <>
      {filtering && (
        // Outside the list's element: the list's typeahead must not take the field's keys.
        <TextField
          label="Find a community"
          labelHidden
          type="search"
          shape="round"
          startIcon="Search"
          placeholder="Find a community"
          value={filter}
          onChange={onFilterChange}
        />
      )}
      <div ref={listRef} {...list.listProps}>
        <LoadState
          state={load}
          label="Communities"
          errorTitle="Couldn't load your communities"
          skeleton={Array.from({ length: ROW_SKELETONS }, (_, index) => (
            <Skeleton key={index} shape="rect" height="lg" />
          ))}
          empty={
            <p>
              <Text tone="secondary">
                {canCreate
                  ? "You're not in any community yet. Create one, or join one with an invite link."
                  : "You're not in any community yet. Join one with an invite link."}
              </Text>
            </p>
          }
        >
          {shown.map((community) => (
            <ListRow
              key={community.id}
              size="lg"
              primary={community.name}
              secondary={stateLine(community)}
              selected={community.id === currentId}
              unread={community.mentions > 0 || community.newMessages}
              leading={<Avatar decorative name={community.name} src={community.src} shape="rounded" />}
              trailing={
                community.mentions > 0 ? (
                  <Badge count={community.mentions} tone="danger" label={mentionText(community.mentions)} />
                ) : undefined
              }
              href={`#/community/${community.id}`}
              focus={list.rowFocus(community.id)}
            />
          ))}
          {filtering && shown.length === 0 && (
            <p>
              <Text tone="secondary">{`No community called “${filter.trim()}”`}</Text>
            </p>
          )}
        </LoadState>
        {footRows}
      </div>
    </>
  );
}

export function AllCommunitiesSheet({ open, onClose, instanceName, username, ...body }: AllCommunitiesSheetProps): JSX.Element {
  return (
    <Sheet open={open} onClose={onClose} title={SHEET_TITLE}>
      <Stack gap="lg">
        <ListRow
          primary={instanceName}
          secondary={username === null ? undefined : `as ${username}`}
          leading={<Avatar decorative name={instanceName} size="sm" shape="rounded" />}
        />
        <Body {...body} />
      </Stack>
    </Sheet>
  );
}

export interface AllCommunitiesSheetConnectedProps {
  open: boolean;
  onClose(reason: SheetCloseReason): void;
  /** The current community, from the route's params. */
  currentId: string | null;
}

/** The sheet from the server's list, the one unread query, the create permission and the call. */
export function AllCommunitiesSheetConnected({ open, onClose, currentId }: AllCommunitiesSheetConnectedProps): JSX.Element {
  const mine = useMyCommunities();
  const { communities, query } = mine;
  const unread = useUnreadSummary();
  const canCreate = useCanCreateCommunity();
  const { instanceName, username } = useInstanceIdentity();
  const callCommunityId = useCallCommunityId();
  const range = useWidthRange();
  const { pathname } = useLocation();
  const [filter, setFilter] = useState('');
  const { pictures, onUrl } = useCommunityPictures();

  const items = useMemo<SheetCommunity[]>(
    () =>
      communities.map((community) => {
        const counts = unread.community(community.id);
        return {
          id: community.id,
          name: community.name,
          src: pictures.get(community.id),
          mentions: counts.mentions,
          newMessages: counts.hasUnread && counts.mentions === 0,
          inYourCall: community.id === callCommunityId,
        };
      }),
    [communities, unread, pictures, callCommunityId],
  );

  const useLoad = useCallback(
    // eslint-disable-next-line react-hooks/rules-of-hooks -- called once per render of the open sheet's body
    () => useQueryLoadState(query, { notifyId: 'all-communities', resetKey: 'mine', isEmpty: (data) => toCommunitySummaries(data).length === 0 }),
    [query],
  );

  const close = useCallback(
    (reason: SheetCloseReason) => {
      setFilter('');
      onClose(reason);
    },
    [onClose],
  );

  const onActivate = useCallback(
    (id: string) => {
      // Back from the community's (old-shell) screen lands on its dock item.
      if (!isFootRow(id)) rememberActivatedRow(pathname, dockRowId(id));
      // The link has navigated; the sheet goes with the screen it was opened from.
      close('button');
    },
    [pathname, close],
  );

  return (
    <>
      {open && <CommunityPictureProbes communities={communities} onUrl={onUrl} />}
      <AllCommunitiesSheet
        open={open}
        onClose={close}
        instanceName={instanceName}
        username={username}
        communities={items}
        currentId={currentId}
        canCreate={canCreate}
        useLoad={useLoad}
        filter={filter}
        onFilterChange={setFilter}
        showSettings={range === 'phone'}
        onActivate={onActivate}
      />
    </>
  );
}
