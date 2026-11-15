import { useState } from 'react';
import { Button, Text, useAnnounce } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';

function Announcer() {
  const announce = useAnnounce();
  const [said, setSaid] = useState('Nothing announced yet');
  const say = (text: string, politeness: 'polite' | 'assertive') => {
    announce(text, politeness);
    setSaid(`${politeness}: ${text}`);
  };
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: tokens.space.md }}>
        <Button variant="soft" onClick={() => say('Joined Squad Up', 'polite')}>
          Announce politely
        </Button>
        <Button variant="soft" onClick={() => say('Disconnected from Hangout', 'assertive')}>
          Announce assertively
        </Button>
      </div>
      <Text variant="small" tone="secondary">
        What the screen reader is sent (shown here so a sighted reviewer sees it):
      </Text>
      <Text>{said}</Text>
    </>
  );
}

/** `useAnnounce()`: the speech goes to the hidden live regions; this story echoes it on screen. */
export const Announce = () => (
  <KitStage mode="dark">
    <Announcer />
  </KitStage>
);

export const AnnounceLight = () => (
  <KitStage mode="light">
    <Announcer />
  </KitStage>
);
