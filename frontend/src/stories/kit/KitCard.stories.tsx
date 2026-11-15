import type { JSX } from 'react';
import { AvatarStack, Button, Card, Island, Pill, Text } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const noop = () => undefined;

const squad = [
  { name: 'dropbear', colour: '#5FD49A' },
  { name: 'pri', colour: '#C792F0' },
  { name: 'alexk', colour: '#9AA0FF' },
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
              <AvatarStack people={squad} label="dropbear, pri and alexk" />
              <Text variant="meta" tone="secondary">You, dropbear and pri</Text>
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
