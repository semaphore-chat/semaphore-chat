/**
 * The community's text channels in the left island (design §3.3): one keyboard list (`useListFocus`:
 * a single Tab stop, Up/Down/Home/End, typeahead), each a link to the channel's existing route. Unread
 * channels are bold, mentions are a count, the channel you are in is the selected pill, an announcement
 * channel wears the megaphone and a private one the lock (as the classic rows mark them). Each row's
 * accessible name carries what it shows: "clips, unread, 2 mentions". The rows are only what the server's
 * filtered list returned (a private channel you cannot see never arrives).
 *
 * Rows are memoised: an unread change re-renders the row it touched, a presence or voice event none.
 */
import { memo, useCallback, useMemo, useRef, type JSX } from 'react';
import { Badge, Icon, ListRow, LoadState, Skeleton, Stack, Text, useListFocus, type LoadController, type RowFocus } from '../../../../kit';
import { LOUNGE_ROW_ATTRIBUTE } from '../../../routeMemory';
import { sameRowFocus } from '../sameRowFocus';
import { channelTrailingLabel } from './lines';

export interface ChannelItem {
  id: string;
  name: string;
  /** New messages since you last read it (bold). */
  unread: boolean;
  mentions: number;
  isPrivate: boolean;
  /** An announcement channel (`preset === 'ANNOUNCEMENT'`): most members only read it. */
  announcement: boolean;
}

export interface ChannelSectionProps {
  channels: readonly ChannelItem[];
  selectedId: string | null;
  /** The route of a channel. */
  hrefFor(id: string): string;
  /** A row was chosen (it navigates by its link): remember it for coming back. */
  onActivate?(id: string): void;
  /** The channels' load: loading, empty and error faces. */
  state: LoadController;
  /** The community has voice rooms: an empty list says "No text channels yet". */
  hasRooms?: boolean;
  /**
   * The row just chosen whose screen is still on its way (the old shell's chat chunk): `aria-busy` and a spinner,
   * so a slow phone shows the tap was taken.
   */
  busyId?: string | null;
}

const SKELETON_ROWS = 6;

function ChannelSkeleton(): JSX.Element {
  return (
    <Stack gap="sm">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <Skeleton key={i} shape="rect" height="md" />
      ))}
    </Stack>
  );
}

interface ChannelRowProps {
  channel: ChannelItem;
  selected: boolean;
  href: string;
  focus: RowFocus;
  marker: (element: HTMLElement | null) => void;
  busy?: boolean;
}

function ChannelRowView({ channel, selected, href, focus, marker, busy = false }: ChannelRowProps): JSX.Element {
  // The classic rule: the channel you are in shows neither unread nor mentions.
  const mentions = selected ? 0 : channel.mentions;
  const icon = channel.announcement ? 'Megaphone' : channel.isPrivate ? 'Lock' : 'Hash';
  return (
    <ListRow
      ref={marker}
      primary={channel.name}
      href={href}
      selected={selected}
      unread={!selected && channel.unread}
      leading={<Icon name={icon} />}
      trailing={mentions > 0 ? <Badge count={mentions} tone="accent" label={mentions === 1 ? '1 mention' : `${mentions} mentions`} /> : undefined}
      trailingLabel={channelTrailingLabel(channel, mentions)}
      focus={focus}
      busy={busy}
    />
  );
}

/** Re-renders only when its channel, its selection or its Tab stop changed. Exported for the render-count test. */
export const ChannelRow = memo(
  ChannelRowView,
  (a, b) =>
    a.channel === b.channel &&
    a.selected === b.selected &&
    a.href === b.href &&
    a.marker === b.marker &&
    a.busy === b.busy &&
    sameRowFocus(a.focus, b.focus),
);

/** Marks a row's link for RouteFocus (`data-lounge-row`), one stable ref per id. */
function useRowMarkers(): (id: string) => (element: HTMLElement | null) => void {
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  return useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (element) => element?.setAttribute(LOUNGE_ROW_ATTRIBUTE, id);
      refs.current.set(id, ref);
    }
    return ref;
  }, []);
}

export function ChannelSection({
  channels,
  selectedId,
  hrefFor,
  onActivate,
  state,
  hasRooms = false,
  busyId = null,
}: ChannelSectionProps): JSX.Element {
  const rows = useMemo(() => channels.map((channel) => ({ id: channel.id, label: channel.name, disabled: false })), [channels]);
  const list = useListFocus({ rows, selected: selectedId, onSelect: onActivate });
  const marker = useRowMarkers();

  return (
    <Stack gap="xs">
      <Text variant="section" tone="secondary" as="h2">
        Channels
      </Text>
      <LoadState
        state={state}
        label="Channels"
        skeleton={<ChannelSkeleton />}
        empty={
          <Text variant="meta" tone="secondary" as="p">
            {hasRooms ? 'No text channels yet.' : 'No channels yet. They show here once someone creates one.'}
          </Text>
        }
        errorTitle="Couldn't load channels"
      >
        <div {...list.listProps}>
          {channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              selected={channel.id === selectedId}
              href={hrefFor(channel.id)}
              focus={list.rowFocus(channel.id)}
              marker={marker(channel.id)}
              busy={channel.id === busyId}
            />
          ))}
        </div>
      </LoadState>
    </Stack>
  );
}
