import { useState, type JSX } from 'react';
import {
  AvatarStack,
  Button,
  Card,
  Checkbox,
  IconButton,
  Island,
  KeyCap,
  LinearProgress,
  ListRow,
  Pill,
  Skeleton,
  Slider,
  Switch,
  Tabs,
  Text,
  TextField,
} from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const noop = () => undefined;

const squad = [
  { name: 'dropbear', colour: '#5FD49A' },
  { name: 'pri', colour: '#C792F0' },
  { name: 'alexk', colour: '#9AA0FF' },
  { name: 'kwam3', colour: '#6FB1F5' },
];

function VoiceRoomsBody(): JSX.Element {
  return (
    <div style={{ width: tokens.layout.leftColumn, maxWidth: '100%' }}>
      <Island as="aside" label="Voice rooms" padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
          <Text variant="bodyStrong" tone="secondary">Voice rooms</Text>
          <Card selected padding="md">
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: tokens.space['2xs'] }}>
                <Text variant="bodyStrong">Squad Up</Text>
                <Pill tone="accent" size="sm">You're here</Pill>
              </div>
              <Button variant="soft" size="sm" onClick={noop}>Leave</Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm }}>
              <AvatarStack people={squad} label="dropbear, pri, alexk and kwam3" />
              <Text variant="meta" tone="secondary">You, dropbear and 3 more</Text>
            </div>
          </Card>
          <Card onClick={noop} label="Join AFK, kwam3 is in it">
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" tone="secondary">AFK</Text>
              </div>
              <AvatarStack people={[{ name: 'kwam3', colour: '#6FB1F5' }]} label="kwam3" size="xs" />
              <Pill size="sm">1 here</Pill>
            </div>
          </Card>
        </div>
      </Island>
    </div>
  );
}

export const VoiceRooms = () => (
  <KitStage mode="dark">
    <VoiceRoomsBody />
  </KitStage>
);

export const VoiceRoomsLight = () => (
  <KitStage mode="light">
    <VoiceRoomsBody />
  </KitStage>
);

export const VoiceRoomsTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <VoiceRoomsBody />
  </KitStage>
);

/** A button card, a link card and a selected link card; the second button is focused by tabbing in the review. */
export const Clickable = () => (
  <KitStage mode="dark">
    <div style={{ width: 320, maxWidth: '100%' }}>
      <Island padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
          <Card onClick={noop}>
            <div>
              <Text variant="bodyStrong">A button card</Text>
              <div><Text variant="meta" tone="secondary">Press anywhere on the card</Text></div>
            </div>
          </Card>
          <Card href="#room">
            <div>
              <Text variant="bodyStrong">A link card</Text>
              <div><Text variant="meta" tone="secondary">Opens a destination</Text></div>
            </div>
          </Card>
          <Card href="#current" selected>
            <div>
              <Text variant="bodyStrong">The current link card</Text>
              <div><Text variant="meta" tone="secondary">Selected</Text></div>
            </div>
          </Card>
        </div>
      </Island>
    </div>
  </KitStage>
);

export const Paddings = () => (
  <KitStage mode="dark">
    <Row label="padding md, lg">
      {(['md', 'lg'] as const).map((padding) => (
        <div key={padding} style={{ width: 200 }}>
          <Island padding="md">
            <Card padding={padding}>
              <Text variant="bodyStrong">{padding}</Text>
            </Card>
          </Island>
        </div>
      ))}
    </Row>
  </KitStage>
);

/**
 * Every fill-coloured piece on a Card, and a Card inside a Card. Kit pieces know which layer they sit
 * on, so each is drawn to stand out from it: soft buttons, the segmented track, the field box, the
 * key cap, the skeleton, the rail, the switch and the check all read on the card's fill.
 */
function NestedBody(): JSX.Element {
  const [tab, setTab] = useState('a');
  const [name, setName] = useState('');
  const [volume, setVolume] = useState(40);
  const [on, setOn] = useState(false);
  const [checked, setChecked] = useState(false);
  const [dim, setDim] = useState(false);
  const stack = { display: 'flex', flexDirection: 'column', gap: tokens.space.md } as const;
  return (
    <div style={{ width: 360, maxWidth: '100%' }}>
      <Island padding="md">
        <Card>
          <div style={stack}>
            <Text variant="bodyStrong">A card</Text>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space.sm }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong">A card inside a card</Text>
                </div>
                <Pill size="sm">surface</Pill>
                <AvatarStack people={squad} max={2} label="dropbear, pri, alexk and kwam3" size="sm" />
              </div>
            </Card>
            <ListRow
              primary="A row on a card"
              secondary="Hover it: the tint is over the card"
              onClick={noop}
              trailing={<IconButton size="sm" variant="soft" icon="Pin" label="Pin this row" />}
            />
            <div style={{ display: 'flex', gap: tokens.space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="soft" size="sm" onClick={noop}>Soft</Button>
              <Button variant="ghost" size="sm" onClick={noop}>Ghost</Button>
              <Button variant="quietDanger" size="sm" onClick={noop}>Quiet</Button>
              <KeyCap>Ctrl</KeyCap>
              <KeyCap>K</KeyCap>
            </div>
            <Tabs
              variant="segmented"
              label="View"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'a', label: 'Members' },
                { id: 'b', label: 'Roles' },
                { id: 'c', label: 'Bans' },
              ]}
            />
            <TextField label="Nickname" placeholder="Pick one" value={name} onChange={setName} />
            <div style={{ display: 'flex', gap: tokens.space.md, alignItems: 'center' }}>
              <Skeleton shape="circle" />
              <div style={{ flex: 1 }}><Skeleton shape="text" lines={2} /></div>
            </div>
            <LinearProgress label="Upload" value={35} />
            <Slider label="Volume" value={volume} onChange={setVolume} />
            <Switch label="Notifications" checked={on} onChange={setOn} />
            <Checkbox label="Remember me" checked={checked} onChange={setChecked} />
            <Checkbox label="Mute everyone" checked={dim} onChange={setDim} />
          </div>
        </Card>
      </Island>
    </div>
  );
}

export const Nested = () => (
  <KitStage mode="dark">
    <NestedBody />
  </KitStage>
);

export const NestedLight = () => (
  <KitStage mode="light">
    <NestedBody />
  </KitStage>
);
