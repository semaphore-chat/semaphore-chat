import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  Island,
  ListRow,
  Text,
  useListFocus,
  type ListFocusRow,
} from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';

/**
 * Keyboard lists on the list focus host (`useListFocus`): one Tab stop, Up and Down, Home and End,
 * typeahead, Enter and Space. Trailing controls are not Tab stops; Right and Left reach them from the row.
 */

interface Channel {
  id: string;
  name: string;
  locked?: boolean;
  unread?: number;
  voice?: boolean;
}

const CHANNELS: Channel[] = [
  { id: 'general', name: 'general' },
  { id: 'lfg', name: 'lfg', unread: 3 },
  { id: 'clips', name: 'clips', unread: 120 },
  { id: 'staff', name: 'staff', locked: true },
  { id: 'memes', name: 'memes' },
  { id: 'game-night', name: 'Game night', voice: true },
  { id: 'patch-notes', name: 'patch-notes' },
  { id: 'off-topic', name: 'off-topic' },
  { id: 'screenshots', name: 'screenshots', unread: 8 },
  { id: 'music', name: 'music' },
  { id: 'random', name: 'random' },
  { id: 'afk', name: 'afk', voice: true },
];

const toRows = (channels: Channel[]): ListFocusRow[] =>
  channels.map((channel) => ({ id: channel.id, label: channel.name, disabled: channel.locked === true }));

function ChannelListView({
  channels,
  selected,
  onSelect,
  focusOnMount = false,
}: {
  channels: Channel[];
  selected: string | null;
  onSelect: (id: string) => void;
  focusOnMount?: boolean;
}) {
  const list = useListFocus({ rows: toRows(channels), selected, onSelect });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // As Tab into the list would: keyboard focus on the Tab stop, so the ring shows.
    if (focusOnMount) box.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focusOnMount]);
  return (
    <nav aria-label="Channels">
      <div
        ref={box}
        {...list.listProps}
        data-testid="channel-list"
        style={{ maxHeight: 336, overflowY: 'auto' }}
      >
        {channels.map((channel) => (
          <ListRow
            key={channel.id}
            primary={channel.name}
            leading={<Icon name={channel.locked ? 'Lock' : channel.voice ? 'Volume2' : 'Hash'} />}
            href={`#${channel.id}`}
            selected={channel.id === selected}
            unread={channel.unread !== undefined}
            disabled={channel.locked}
            focus={list.rowFocus(channel.id)}
            trailing={
              channel.unread !== undefined ? (
                <>
                  <Badge count={channel.unread} tone="accent" label={`${channel.unread} unread`} />
                  <IconButton size="sm" icon="BellOff" label={`Mute ${channel.name}`} onClick={() => {}} />
                </>
              ) : undefined
            }
          />
        ))}
      </div>
    </nav>
  );
}

function ChannelListDemo({ focusOnMount = false }: { focusOnMount?: boolean }) {
  const [selected, setSelected] = useState<string | null>('general');
  return (
    <div style={{ width: 288, maxWidth: '100%' }}>
      <Island padding="md">
        <ChannelListView channels={CHANNELS} selected={selected} onSelect={setSelected} focusOnMount={focusOnMount} />
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" startIcon={<Icon name="Plus" />} onClick={() => {}}>
            Add channel
          </Button>
        </div>
      </Island>
    </div>
  );
}

const channelBody = (focusOnMount: boolean) => (
  <Row label="Channels: Tab in, Up and Down, Home and End, type a name; Right reaches Mute on unread rows">
    <ChannelListDemo focusOnMount={focusOnMount} />
  </Row>
);

/** A channel list driven by the keyboard: a selected row, a locked (disabled) row, trailing controls, a scroll. */
export const ChannelList = () => <KitStage mode="dark">{channelBody(false)}</KitStage>;

export const ChannelListLight = () => <KitStage mode="light">{channelBody(false)}</KitStage>;

/** The same list with keyboard focus on its Tab stop (the selected row): the focus ring. */
export const ChannelListFocused = () => <KitStage mode="dark">{channelBody(true)}</KitStage>;

export const ChannelListFocusedLight = () => <KitStage mode="light">{channelBody(true)}</KitStage>;

const PEOPLE = ['aiko', 'gracie', 'Diego', 'dropbear', 'kwam3', 'pri', 'Samira', 'zara'];

/** Button rows that count what Enter, Space or a click chose; a tall page under them to show Space does not scroll it. */
function PeopleDemo() {
  const [opened, setOpened] = useState<string[]>([]);
  const rows = PEOPLE.map((name) => ({ id: name, label: name, disabled: false }));
  // Opened counts the list's choices (onSelect): Enter, Space or a click, once each.
  const list = useListFocus({ rows, selected: null, onSelect: (name) => setOpened((before) => [...before, name]) });
  return (
    <div style={{ width: 288, maxWidth: '100%' }}>
      <Island padding="md">
        <div {...list.listProps} data-testid="people-list">
          {PEOPLE.map((name) => (
            <ListRow
              key={name}
              primary={name}
              onClick={() => {}}
              focus={list.rowFocus(name)}
            />
          ))}
        </div>
      </Island>
      <div style={{ marginTop: 16 }}>
        <Text variant="meta" tone="secondary">
          <span data-testid="opened">Opened: {opened.length === 0 ? 'nobody' : opened.join(', ')}</span>
        </Text>
      </div>
      <div style={{ height: 1600 }} aria-hidden />
    </div>
  );
}

export const ButtonRows = () => (
  <KitStage mode="dark">
    <Row label="Button rows: Enter and Space open the focused person once">
      <PeopleDemo />
    </Row>
  </KitStage>
);

/** The selection set from outside (a route, a value prop): the pill and the Tab stop follow; focus stays put. */
function OutsideDemo() {
  const [selected, setSelected] = useState<string | null>('clips');
  const channels = CHANNELS.slice(0, 6);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 288, maxWidth: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button size="sm" variant="soft" onClick={() => setSelected('general')}>
          Go to #general
        </Button>
        <Button size="sm" variant="soft" onClick={() => setSelected('memes')}>
          Go to #memes
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
          Clear
        </Button>
      </div>
      <Island padding="md">
        <ChannelListView channels={channels} selected={selected} onSelect={setSelected} />
      </Island>
      <Text variant="meta" tone="secondary">
        <span data-testid="selected">Selected: {selected ?? 'none'}</span>
      </Text>
    </div>
  );
}

export const SelectionFromOutside = () => (
  <KitStage mode="dark">
    <Row label="Selection set from outside">
      <OutsideDemo />
    </Row>
  </KitStage>
);

export const SelectionFromOutsideLight = () => (
  <KitStage mode="light">
    <Row label="Selection set from outside">
      <OutsideDemo />
    </Row>
  </KitStage>
);
