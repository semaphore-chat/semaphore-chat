import { useState, type JSX, type ReactNode } from 'react';
import { Avatar, Badge, Button, Icon, ListRow, Sheet, Text, TextField, type SheetProps } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';
import { PageBehind } from './kitOverlayAnchor';

interface Community {
  name: string;
  colour: string;
  note: string;
  unread?: number;
  current?: boolean;
}

const GROUPS: { instance: string; as: string; mark: string; colour: string; communities: Community[] }[] = [
  {
    instance: 'moss.social',
    as: 'alexk',
    mark: 'MS',
    colour: '#6FD39A',
    communities: [
      { name: 'Couch Co-op', colour: '#FF9A6B', note: '2 in voice', current: true },
      { name: 'Trailheads', colour: '#6FD39A', note: 'quiet' },
      { name: 'Wavelength', colour: '#F08FC0', note: '3 unread', unread: 3 },
      { name: 'Retro Night', colour: '#FFA366', note: '1 in voice' },
    ],
  },
  {
    instance: 'lumen.studio',
    as: 'alex.kim',
    mark: 'LU',
    colour: '#6BC5E0',
    communities: [
      { name: 'Lumen Studio', colour: '#6BC5E0', note: '2 unread', unread: 2 },
      { name: 'Pixel Pushers', colour: '#C792F0', note: 'quiet' },
    ],
  },
];

function Communities(): JSX.Element {
  const [query, setQuery] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
      <TextField
        label="Search communities"
        labelHidden
        shape="round"
        startIcon="Search"
        placeholder="Jump to a community, channel or person"
        value={query}
        onChange={setQuery}
      />
      {GROUPS.map((group) => (
        <section key={group.instance} aria-label={group.instance} style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.xs }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm, padding: `0 ${tokens.space.xs}px` }}>
            <Avatar decorative name={group.mark} colour={group.colour} size="xs" shape="rounded" />
            <Text variant="name">{group.instance}</Text>
            <Text variant="meta" tone="secondary">as {group.as}</Text>
          </div>
          {group.communities.map((community) => (
            <ListRow
              key={community.name}
              size="lg"
              primary={community.name}
              secondary={community.note}
              selected={community.current}
              unread={community.unread !== undefined}
              leading={<Avatar decorative name={community.name} colour={community.colour} shape="rounded" />}
              trailing={
                community.unread === undefined ? undefined : <Badge count={community.unread} tone="accent" label={`${community.unread} unread`} />
              }
              onClick={() => undefined}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function Open({ children, actions, size, title = 'All communities' }: { children: ReactNode; actions?: ReactNode; size?: SheetProps['size']; title?: string }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{title}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title} actions={actions} size={size}>
        {children}
      </Sheet>
    </>
  );
}

const Page = ({ mode, base, intensity, children }: { mode: ModeName; base?: string; intensity?: IntensityName; children: ReactNode }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <PageBehind />
    {children}
  </KitStage>
);

const allCommunities = (
  <Open size="lg">
    <Communities />
  </Open>
);

/** The "All communities" sheet: a search field, then communities grouped under their instance. */
export const AllCommunities = () => <Page mode="dark">{allCommunities}</Page>;

export const AllCommunitiesLight = () => <Page mode="light">{allCommunities}</Page>;

export const AllCommunitiesTinted = () => (
  <Page mode="dark" base="#0d9488" intensity="vibrant">
    {allCommunities}
  </Page>
);

/** An actions row pinned under a short body. */
export const WithActions = () => (
  <Page mode="dark">
    <Open
      title="Pin communities"
      actions={
        <>
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary">Save</Button>
        </>
      }
    >
      <Text tone="secondary">Pinned communities show in the bar, in this order.</Text>
      <div style={{ marginTop: tokens.space.md }}>
        <Communities />
      </div>
    </Open>
  </Page>
);

/** Forty rows: the header and the actions stay, the body scrolls inside the sheet. */
export const LongContent = () => (
  <Page mode="dark">
    <Open
      title="Notifications"
      actions={<Button variant="primary">Mark all read</Button>}
    >
      {Array.from({ length: 40 }, (_, index) => (
        <ListRow key={index} primary={`Notification ${index + 1}`} secondary="Someone mentioned you in #general" leading={<Icon name="Bell" />} size="lg" onClick={() => undefined} />
      ))}
    </Open>
  </Page>
);

/** Judge at 390 px: a full-width bottom sheet with rounded top corners that stops above the dock's height. */
export const Phone = () => (
  <Page mode="dark">
    <Open
      size="lg"
      actions={<Button variant="ghost">Manage communities</Button>}
    >
      <Communities />
    </Open>
  </Page>
);

/** `top`: a heading and a search field fixed above a long body; only the rows scroll. */
export const WithTop = () => {
  const [query, setQuery] = useState('');
  return (
    <Page mode="dark">
      <Sheet
        open
        onClose={() => undefined}
        title="All communities"
        top={<TextField label="Search communities" labelHidden shape="round" startIcon="Search" placeholder="Find a community" value={query} onChange={setQuery} />}
      >
        {Array.from({ length: 40 }, (_, index) => (
          <ListRow key={index} primary={`Community ${index + 1}`} secondary="Quiet" size="lg" onClick={() => undefined} />
        ))}
      </Sheet>
    </Page>
  );
};

/** A filling sheet (`fill`): the content brings its own header with Close, a body that scrolls itself and a field at the foot (a thread). */
function FillContent({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm, padding: tokens.space.md }}>
        <div style={{ flex: '1 1 auto' }}>
          <Text variant="title" as="h2">
            Thread
          </Text>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: `0 ${tokens.space.md}px` }}>
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i}>
            <Text>Reply {i + 1}: we wiped four times on that drop</Text>
          </div>
        ))}
      </div>
      <div style={{ padding: tokens.space.md }}>
        <TextField label="Reply in thread" labelHidden shape="round" value="" onChange={() => undefined} />
      </div>
    </div>
  );
}

function OpenFill(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Thread</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Thread" fill>
        <FillContent onClose={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

export const Fill = () => (
  <Page mode="dark">
    <OpenFill />
  </Page>
);

export const FillLight = () => (
  <Page mode="light">
    <OpenFill />
  </Page>
);
