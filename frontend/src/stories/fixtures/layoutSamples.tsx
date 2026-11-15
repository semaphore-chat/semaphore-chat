import { useState, type JSX } from 'react';
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  Dock,
  DockDivider,
  DockItem,
  Icon,
  IconButton,
  ListRow,
  Pill,
  Switch,
  Text,
  TextField,
} from '../../kit';
import { tokens } from '../../theme/generated/tokens';

/** The sample data of the Lounge mock-ups (STYLE.md), shaped as small pieces the layout stories fill their slots with. */

const noop = () => undefined;

/** Three communities and the two buttons fill the 288 px left column of a wide screen, as in the mock-up. */
const COMMUNITIES = [
  { name: 'Couch Co-op', colour: '#FF9A6B', current: true },
  { name: 'Lumen Studio', colour: '#6BC5E0', unread: 2 },
  { name: 'Friday LAN', colour: '#E0C060', status: 'reconnecting' as const },
];

export function SampleDock(): JSX.Element {
  return (
    <Dock label="Pinned communities">
      <IconButton icon="Inbox" label="Inbox, 9 unread across all instances" variant="primary" />
      <DockDivider />
      {COMMUNITIES.map((community) => (
        <DockItem key={community.name} {...community} onClick={noop} />
      ))}
      <DockDivider />
      <IconButton icon="LayoutGrid" label="All communities" variant="soft" />
    </Dock>
  );
}

const column = { display: 'flex', flexDirection: 'column' } as const;
const hash = <Icon name="Hash" />;

/** The place: the community's header, its channels and its voice rooms. */
export function SampleChannels(): JSX.Element {
  return (
    <div style={{ ...column, gap: tokens.space.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.md, padding: `${tokens.space.xs}px ${tokens.space.sm}px` }}>
        <Avatar decorative name="Couch Co-op" colour="#FF9A6B" shape="rounded" size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="name" truncate>Couch Co-op</Text>
          <div><Text variant="meta" tone="secondary" truncate>moss.social</Text></div>
        </div>
        <IconButton icon="Settings" label="Community settings" variant="ghost" />
      </div>
      <div style={column}>
        <ListRow primary="general" leading={hash} selected href="#general" />
        <ListRow primary="clips" leading={hash} unread href="#clips" trailing={<Badge count={2} tone="accent" label="2 unread" />} />
        <ListRow primary="lfg" leading={hash} href="#lfg" />
        <ListRow primary="memes" leading={hash} href="#memes" />
      </div>
      <div style={{ ...column, gap: tokens.space.sm }}>
        <Text variant="section" tone="secondary" as="h2">Voice rooms</Text>
        <Card selected>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm }}>
            <div style={{ flex: 1, minWidth: 0, ...column, alignItems: 'flex-start', gap: tokens.space['2xs'] }}>
              <Text variant="bodyStrong">Squad Up</Text>
              <Pill tone="accent" size="sm">You're here</Pill>
            </div>
            <Button variant="soft" size="sm" onClick={noop}>Leave</Button>
          </div>
          <AvatarStack
            label="dropbear, pri and alexk"
            people={[
              { name: 'dropbear', colour: '#5FD49A' },
              { name: 'pri', colour: '#C792F0' },
              { name: 'alexk', colour: '#9AA0FF' },
            ]}
          />
        </Card>
        <Card onClick={noop} label="Join AFK, kwam3 is in it">
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" tone="secondary">AFK</Text>
            </div>
            <Pill size="sm">1 here</Pill>
          </div>
        </Card>
      </div>
    </div>
  );
}

const MESSAGES = [
  { who: 'dropbear', colour: '#5FD49A', at: '8:41', text: 'found the clip from last night, it is somehow even better in slow motion' },
  { who: 'pri', colour: '#C792F0', at: '8:43', text: 'send it over, the couch demands it' },
  { who: 'aiko', colour: '#FF8FB8', at: '8:47', text: 'also lfg for tonight? we are one short for the co-op run' },
  { who: 'kwam3', colour: '#6FB1F5', at: '8:52', text: 'in, but I need ten minutes to find a headset that works' },
  { who: 'alexk', colour: '#9AA0FF', at: '8:53', text: 'ten minutes it is. Squad Up at nine?' },
];

/** The conversation: a header, the messages and the composer. It brings its own padding (the island has none). */
export function SampleConversation({ rows = MESSAGES.length }: { rows?: number }): JSX.Element {
  const [draft, setDraft] = useState('');
  return (
    <div style={{ ...column, flex: '1 1 auto', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.md, padding: `${tokens.space.md}px ${tokens.space.lg}px ${tokens.space.sm}px ${tokens.space.xl}px` }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: tokens.space.md }}>
          <Text variant="title" as="h1" truncate>general</Text>
        </div>
        <IconButton icon="Search" label="Search" variant="soft" />
        <IconButton icon="Users" label="Members" variant="soft" />
      </div>
      <div style={{ ...column, flex: '1 1 0', minHeight: 0, overflowY: 'auto', gap: tokens.space.lg, padding: `${tokens.space.md}px ${tokens.space.xl}px` }}>
        {MESSAGES.slice(0, rows).map((message) => (
          <div key={message.who + message.at} style={{ display: 'flex', gap: tokens.space.md }}>
            <Avatar decorative name={message.who} colour={message.colour} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: tokens.space.sm }}>
                <Text variant="name">{message.who}</Text>
                <Text variant="meta" tone="secondary">{message.at}</Text>
              </div>
              <Text>{message.text}</Text>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: `${tokens.space.sm}px ${tokens.space.lg}px ${tokens.space.lg}px` }}>
        <TextField
          label="Message general"
          labelHidden
          shape="round"
          placeholder="Message #general"
          value={draft}
          onChange={setDraft}
        />
      </div>
    </div>
  );
}

const PEOPLE = [
  { name: 'Samira', note: 'Admin', colour: '#5ED1D1', presence: 'online' as const },
  { name: 'dropbear', note: 'Streaming', colour: '#5FD49A', presence: 'speaking' as const },
  { name: 'gracie', note: 'Mod', colour: '#FFA366', presence: 'online' as const },
  { name: 'kwam3', note: 'Away', colour: '#6FB1F5', presence: 'away' as const },
  { name: 'pri', colour: '#C792F0', presence: 'online' as const },
  { name: 'zara', note: 'Offline', colour: undefined, presence: 'offline' as const },
];

/** The context: who is around. */
export function SampleMembers(): JSX.Element {
  return (
    <div style={{ ...column, gap: tokens.space.sm }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: `0 ${tokens.space.xs}px` }}>
        <Text variant="title" as="h2">Who's around</Text>
        <Text variant="meta" tone="secondary">5 of 12</Text>
      </div>
      <div style={column}>
        {PEOPLE.map((person) => (
          <ListRow
            key={person.name}
            size="lg"
            primary={person.name}
            secondary={person.note}
            muted={person.presence === 'offline'}
            leading={<Avatar decorative name={person.name} colour={person.colour} presence={person.presence} />}
            onClick={noop}
          />
        ))}
      </div>
    </div>
  );
}

const SECTIONS = ['General', 'Roles', 'Channels', 'Members', 'Invites', 'Moderation', 'Emoji', 'Danger zone'];

/** The sections of the community settings, one selected. */
export function SampleSections({ selected = 'Roles' }: { selected?: string }): JSX.Element {
  return (
    <div style={column}>
      {SECTIONS.map((name) => (
        <ListRow key={name} primary={name} selected={name === selected} onClick={noop} />
      ))}
    </div>
  );
}

/** The section being edited: a few fields and switches. */
export function SampleRoleForm(): JSX.Element {
  const [name, setName] = useState('Mods');
  const [flags, setFlags] = useState([true, false, true]);
  const rows = [
    ['Manage messages', 'Delete and pin messages in every channel.'],
    ['Manage members', 'Kick and time out members.'],
    ['Mention everyone', 'Notify the whole community.'],
  ];
  return (
    <div style={{ ...column, gap: tokens.space.xl, maxWidth: tokens.layout.dialogMd * 1.5 }}>
      <Text variant="title" as="h2">Edit role: Mods</Text>
      <TextField label="Role name" value={name} onChange={setName} />
      <div style={{ ...column, gap: tokens.space.lg }}>
        {rows.map(([label, description], index) => (
          <Switch
            key={label}
            label={label}
            description={description}
            checked={flags[index]}
            onChange={(checked) => setFlags(flags.map((flag, i) => (i === index ? checked : flag)))}
          />
        ))}
      </div>
      <Text tone="secondary">Roles apply to everyone who has them, in every channel the role can see.</Text>
    </div>
  );
}

export function SampleUnsaved(): JSX.Element {
  return (
    <>
      <Text variant="bodyStrong">2 unsaved changes</Text>
      <Button variant="ghost" onClick={noop}>Reset</Button>
      <Button variant="primary" onClick={noop}>Save changes</Button>
    </>
  );
}

/** A 16:9 block standing for the shared screen: a Card stretched over a box sized to fit the stage's width or height, whichever runs out first. */
export function SampleScreen(): JSX.Element {
  return (
    <div
      role="img"
      aria-label="dropbear's shared screen"
      style={{ aspectRatio: '16 / 9', width: 'min(100cqw, calc(100cqh * 16 / 9))', display: 'grid' }}
    >
      <Card padding="lg">
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text tone="secondary">dropbear is sharing their screen</Text>
        </div>
      </Card>
    </div>
  );
}

const TILES = [
  { name: 'dropbear', colour: '#5FD49A', presence: 'speaking' as const },
  { name: 'pri', colour: '#C792F0', presence: 'online' as const },
  { name: 'alexk', colour: '#9AA0FF', presence: 'online' as const },
];

export function SampleStrip(): JSX.Element {
  return (
    <>
      {TILES.map((tile) => (
        <div key={tile.name} style={{ flex: '1 1 0', minWidth: 0 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm }}>
              <Avatar decorative name={tile.name} colour={tile.colour} presence={tile.presence} />
              <Text variant="name" truncate>{tile.name}</Text>
            </div>
          </Card>
        </div>
      ))}
    </>
  );
}

export function SampleStageHeader(): JSX.Element {
  return (
    <>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: tokens.space.md }}>
        <Text variant="title" as="h1" truncate>Squad Up</Text>
        <Text variant="meta" tone="secondary" truncate>3 here · 42:10</Text>
      </div>
      <IconButton icon="Users" label="People" variant="soft" />
    </>
  );
}

export function SampleControls(): JSX.Element {
  return (
    <>
      <IconButton icon="Mic" label="Mute" variant="soft" size="lg" />
      <IconButton icon="Headphones" label="Deafen" variant="soft" size="lg" />
      <IconButton icon="Video" label="Camera" variant="soft" size="lg" />
      <IconButton icon="ScreenShare" label="Share your screen" variant="soft" size="lg" />
      <IconButton icon="PhoneOff" label="Leave" variant="danger" size="lg" />
    </>
  );
}

export function SamplePeople(): JSX.Element {
  return (
    <div style={column}>
      {TILES.map((tile) => (
        <ListRow
          key={tile.name}
          size="lg"
          primary={tile.name}
          leading={<Avatar decorative name={tile.name} colour={tile.colour} presence={tile.presence} />}
          onClick={noop}
        />
      ))}
    </div>
  );
}
