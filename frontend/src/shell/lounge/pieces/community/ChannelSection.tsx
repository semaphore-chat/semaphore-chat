/**
 * The community's text channels in the left island (design §3.3): one keyboard list (`useListFocus`:
 * a single Tab stop, Up/Down/Home/End, typeahead), each a link to the channel's existing route. Unread
 * channels are bold, mentions are a count, the channel you are in is the selected pill, a private
 * channel wears the lock. The rows are only what the server's filtered list returned (a private
 * channel you cannot see never arrives).
 */
import { useCallback, useMemo, useRef, type JSX } from 'react';
import { Badge, Icon, ListRow, LoadState, Skeleton, Stack, Text, useListFocus, type LoadController } from '../../../../kit';
import { LOUNGE_ROW_ATTRIBUTE } from '../../frame/routeMemory';

export interface ChannelItem {
  id: string;
  name: string;
  /** New messages since you last read it (bold). */
  unread: boolean;
  mentions: number;
  isPrivate: boolean;
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

export function ChannelSection({ channels, selectedId, hrefFor, onActivate, state }: ChannelSectionProps): JSX.Element {
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
            No channels yet. They show here once someone creates one.
          </Text>
        }
        errorTitle="Couldn't load channels"
      >
        <div {...list.listProps}>
          {channels.map((channel) => {
            const selected = channel.id === selectedId;
            const mentions = selected ? 0 : channel.mentions;
            return (
              <ListRow
                key={channel.id}
                ref={marker(channel.id)}
                primary={channel.name}
                href={hrefFor(channel.id)}
                selected={selected}
                unread={!selected && channel.unread}
                leading={<Icon name={channel.isPrivate ? 'Lock' : 'Hash'} label={channel.isPrivate ? 'Private channel' : undefined} />}
                trailing={
                  mentions > 0 ? (
                    <Badge count={mentions} tone="accent" label={mentions === 1 ? '1 mention' : `${mentions} mentions`} />
                  ) : undefined
                }
                focus={list.rowFocus(channel.id)}
              />
            );
          })}
        </div>
      </LoadState>
    </Stack>
  );
}
