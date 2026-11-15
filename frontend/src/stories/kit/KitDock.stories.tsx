import { useState, type ComponentProps, type JSX, type ReactNode } from 'react';
import { Badge, Button, Dock, DockDivider, DockItem, IconButton, useListFocus } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const noop = () => undefined;

/** The inbox button with the unread count over its corner, like the mock-up. */
function Inbox(): JSX.Element {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto' }}>
      <IconButton icon="Inbox" label="Inbox, 9 unread across all instances" variant="primary" />
      <span
        aria-hidden="true"
        style={{ position: 'absolute', top: -tokens.space.xs, right: -tokens.space.xs }}
      >
        <Badge count={9} label="9 unread" />
      </span>
    </span>
  );
}

const COMMUNITIES = [
  { name: 'Couch Co-op', colour: '#FF9A6B', current: true },
  { name: 'Trailheads', colour: '#6FD39A' },
  { name: 'Lumen Studio', colour: '#6BC5E0', unread: 2 },
  { name: 'Friday LAN', colour: '#E0C060', status: 'reconnecting' as const },
  { name: 'Wavelength', colour: '#F08FC0' },
];

type BarItem = ComponentProps<typeof DockItem>;

function Bar({ items = COMMUNITIES }: { items?: readonly BarItem[] }): JSX.Element {
  return (
    <Dock label="Pinned communities">
      <Inbox />
      <DockDivider />
      {items.map((community) => (
        <DockItem key={community.name} {...community} onClick={noop} />
      ))}
      <DockDivider />
      <IconButton icon="LayoutGrid" label="All communities" variant="soft" />
    </Dock>
  );
}

const Page = ({ mode, base, intensity, children }: { mode: ModeName; base?: string; intensity?: IntensityName; children: ReactNode }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    {children}
  </KitStage>
);

const Wide = ({ children }: { children: ReactNode }) => (
  <div style={{ width: 380, maxWidth: '100%' }}>{children}</div>
);

/** The bar from the mock-up: inbox with a count, a divider, five communities (current, unread, reconnecting) and All. */
export const Communities = () => (
  <Page mode="dark">
    <Row label="Pinned communities">
      <Wide>
        <Bar />
      </Wide>
    </Row>
  </Page>
);

export const CommunitiesLight = () => (
  <Page mode="light">
    <Wide>
      <Bar />
    </Wide>
  </Page>
);

export const CommunitiesTinted = () => (
  <Page mode="dark" base="#0d9488" intensity="vibrant">
    <Wide>
      <Bar />
    </Wide>
  </Page>
);

const MANY = Array.from({ length: 14 }, (_, index) => ({
  name: ['Aurora', 'Bytes', 'Couch Co-op', 'Dune', 'Ember', 'Fjord', 'Glow', 'Harbor', 'Ink', 'Juniper', 'Kite', 'Lumen Studio', 'Moss', 'Nook'][index],
  colour: ['#FF9A6B', '#6FD39A', '#6BC5E0', '#E0C060', '#F08FC0', '#C792F0', '#FF8FB8'][index % 7],
  current: index === 11,
  unread: index === 3 ? 4 : undefined,
}));

/** 14 communities in a 288 px box, the 12th current: the bar scrolls sideways and starts with the current one in view. */
export const Overflow = () => (
  <Page mode="dark">
    <div style={{ width: tokens.layout.leftColumn }}>
      <Dock label="Pinned communities">
        {MANY.map((community) => (
          <DockItem key={community.name} {...community} onClick={noop} />
        ))}
      </Dock>
    </div>
  </Page>
);

/** The dock as the phone's bottom bar: full width at the foot of a 390 px frame. */
export const PhoneBar = () => (
  <KitStage mode="dark">
    <div
      style={{
        width: 390,
        maxWidth: '100%',
        minHeight: 360,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <Bar />
    </div>
  </KitStage>
);

/** A Dock as one keyboard list: Inbox, `count` communities and All, driven by `useListFocus` (horizontal). */
function FocusBar({ count, current }: { count: number; current: number }): JSX.Element {
  const names = Array.from({ length: count }, (_, index) => {
    const base = COMMUNITY_NAMES[index % COMMUNITY_NAMES.length];
    return index < COMMUNITY_NAMES.length ? base : `${base} ${Math.floor(index / COMMUNITY_NAMES.length) + 1}`;
  });
  const rows = [
    { id: 'inbox', label: 'Inbox', disabled: false },
    ...names.map((name) => ({ id: name, label: name, disabled: false })),
    { id: 'all', label: 'All communities', disabled: false },
  ];
  const [chosen, setChosen] = useState<string>(names[current]);
  const list = useListFocus({ rows, selected: chosen, orientation: 'horizontal', onSelect: setChosen });
  return (
    <>
      <Dock label="Pinned communities" focus={list.bar}>
        <IconButton icon="Inbox" label="Inbox" variant="primary" focus={list.rowFocus('inbox')} />
        <DockDivider />
        {names.map((name, index) => (
          <DockItem
            key={name}
            name={name}
            colour={COLOURS[index % COLOURS.length]}
            current={name === chosen}
            newMessages={index % 5 === 3}
            unread={index % 7 === 2 ? index : undefined}
            onClick={noop}
            focus={list.rowFocus(name)}
          />
        ))}
        <DockDivider />
        <IconButton icon="LayoutGrid" label="All communities" variant="soft" focus={list.rowFocus('all')} />
      </Dock>
      {/* Something to Tab to: the bar is one stop, and the next Tab must leave it. */}
      <div style={{ marginTop: tokens.space.lg }}>
        <Button variant="soft" size="sm">After the dock</Button>
      </div>
    </>
  );
}

const COMMUNITY_NAMES = ['Couch Co-op', 'Trailheads', 'Lumen Studio', 'Friday LAN', 'Wavelength', 'Aurora', 'Bytes', 'Dune', 'Ember', 'Fjord', 'Glow', 'Harbor'];
const COLOURS = ['#FF9A6B', '#6FD39A', '#6BC5E0', '#E0C060', '#F08FC0', '#C792F0', '#FF8FB8'];

/** 12 communities on the list focus host: one Tab stop (on the current one), arrows, Home and End; scrolls to follow focus. */
export const FocusTwelve = () => (
  <Page mode="dark">
    <Wide>
      <FocusBar count={12} current={4} />
    </Wide>
  </Page>
);

export const FocusTwelveLight = () => (
  <Page mode="light">
    <Wide>
      <FocusBar count={12} current={4} />
    </Wide>
  </Page>
);

/** 60 communities, the 40th current: the bar scrolls, and focus keeps the focused item in view. */
export const FocusSixty = () => (
  <Page mode="dark">
    <Wide>
      <FocusBar count={60} current={39} />
    </Wide>
  </Page>
);

/** The same as the phone's bottom bar, full width at the foot of a 390 px frame. */
export const FocusSixtyPhone = () => (
  <KitStage mode="dark">
    <div style={{ width: 390, maxWidth: '100%', minHeight: 360, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <FocusBar count={60} current={39} />
    </div>
  </KitStage>
);

const NEW_MESSAGES = [
  { name: 'Couch Co-op', colour: '#FF9A6B', current: true },
  { name: 'Trailheads', colour: '#6FD39A', newMessages: true },
  { name: 'Lumen Studio', colour: '#6BC5E0', unread: 2, newMessages: true },
  { name: 'Friday LAN', colour: '#E0C060', status: 'reconnecting' as const, newMessages: true },
  { name: 'Wavelength', colour: '#F08FC0' },
];

const CURRENT_DOT = NEW_MESSAGES.map((item, index) => (index === 0 ? { ...item, newMessages: true } : item));
const CURRENT_COUNT = NEW_MESSAGES.map((item, index) => (index === 0 ? { ...item, unread: 3 } : item));
const CURRENT_BOTH = NEW_MESSAGES.map((item, index) => (index === 0 ? { ...item, unread: 3, newMessages: true } : item));

const NewMessagesBody = () => (
  <>
    <Row label="Pinned communities: Trailheads has a dot, Lumen Studio a count (the badge wins), Friday LAN a dot and reconnecting">
      <Wide>
        <Bar items={NEW_MESSAGES} />
      </Wide>
    </Row>
    <Row label="The current community with a dot (Couch Co-op)">
      <Wide>
        <Bar items={CURRENT_DOT} />
      </Wide>
    </Row>
    <Row label="The current community with a count">
      <Wide>
        <Bar items={CURRENT_COUNT} />
      </Wide>
    </Row>
    <Row label="The current community with a count and a dot: the count wins">
      <Wide>
        <Bar items={CURRENT_BOTH} />
      </Wide>
    </Row>
  </>
);

/** "New messages" dot, alone and on the current community; a count wins over it. */
export const NewMessages = () => (
  <Page mode="dark">
    <NewMessagesBody />
  </Page>
);

export const NewMessagesLight = () => (
  <Page mode="light">
    <NewMessagesBody />
  </Page>
);

export const NewMessagesTinted = () => (
  <Page mode="dark" base="#0d9488" intensity="vibrant">
    <NewMessagesBody />
  </Page>
);

/** Inbox (with its count) fixed at the start, All fixed at the end, the communities scrolling between: fades mark the edges with more. */
function SlotBar({ count, current, inboxCurrent = false }: { count: number; current: number; inboxCurrent?: boolean }): JSX.Element {
  const names = Array.from({ length: count }, (_, index) => {
    const base = COMMUNITY_NAMES[index % COMMUNITY_NAMES.length];
    return index < COMMUNITY_NAMES.length ? base : `${base} ${Math.floor(index / COMMUNITY_NAMES.length) + 1}`;
  });
  return (
    <Dock
      label="Communities"
      start={
        <>
          <IconButton icon="Inbox" label="Inbox" variant="primary" badge={9} current={inboxCurrent} />
          <DockDivider />
        </>
      }
      end={
        <>
          <DockDivider />
          <IconButton icon="LayoutGrid" label="All communities" variant="soft" />
        </>
      }
    >
      {names.map((name, index) => (
        <DockItem
          key={name}
          name={name}
          colour={COLOURS[index % COLOURS.length]}
          current={!inboxCurrent && index === current}
          unread={index % 4 === 2 ? index + 1 : undefined}
          unreadLabel="mentions"
          newMessages={index % 5 === 3}
          onClick={noop}
        />
      ))}
    </Dock>
  );
}

/** `start` and `end` in the 288 px left column: five communities scroll, Inbox and All stay; no badge cut at an edge. */
export const FixedEnds = () => (
  <Page mode="dark">
    <Row label="Five communities, the last current">
      <div style={{ width: tokens.layout.leftColumn }}>
        <SlotBar count={5} current={4} />
      </div>
    </Row>
    <Row label="Twelve, the sixth current: fades at both edges">
      <div style={{ width: tokens.layout.leftColumn }}>
        <SlotBar count={12} current={5} />
      </div>
    </Row>
    <Row label="Two: everything fits, centred, no fade">
      <div style={{ width: tokens.layout.leftColumn }}>
        <SlotBar count={2} current={0} />
      </div>
    </Row>
    <Row label="The inbox is the current place (the ring) with its count">
      <div style={{ width: tokens.layout.leftColumn }}>
        <SlotBar count={3} current={0} inboxCurrent />
      </div>
    </Row>
  </Page>
);

/** The same, light. */
export const FixedEndsLight = () => (
  <Page mode="light">
    <div style={{ width: tokens.layout.leftColumn }}>
      <SlotBar count={12} current={5} />
    </div>
    <div style={{ width: tokens.layout.leftColumn }}>
      <SlotBar count={3} current={0} inboxCurrent />
    </div>
  </Page>
);

/** Sixty in a phone-width bar, the 55th current. */
export const FixedEndsPhone = () => (
  <Page mode="dark">
    <div style={{ width: 390, maxWidth: '100%' }}>
      <SlotBar count={60} current={54} />
    </div>
  </Page>
);

/** Fixed ends on a tinted palette. */
export const FixedEndsTinted = () => (
  <Page mode="dark" base="#0d9488" intensity="vibrant">
    <div style={{ width: tokens.layout.leftColumn }}>
      <SlotBar count={12} current={5} />
    </div>
    <div style={{ width: tokens.layout.leftColumn }}>
      <SlotBar count={3} current={0} inboxCurrent />
    </div>
  </Page>
);
