import { useState } from 'react';
import { ReactionChip } from '../../kit';
import { Row } from '../fixtures/kitStory';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, PARROT_SRC, noop } from './kitChatData';

const Toggle = () => {
  const [mine, setMine] = useState(false);
  return <ReactionChip emoji="🎉" label="Party" count={mine ? 3 : 2} mine={mine} onToggle={() => setMine(!mine)} />;
};

const Body = () => (
  <ChatColumn>
    <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Row label="Not mine, mine">
        <ReactionChip emoji="😂" label="Laugh" count={4} onToggle={noop} />
        <ReactionChip emoji="😂" label="Laugh" count={4} mine onToggle={noop} />
      </Row>
      <Row label="Big counts: 999 in full, then compact; the name keeps the exact count">
        <ReactionChip emoji="🔥" label="Fire" count={999} onToggle={noop} />
        <ReactionChip emoji="🔥" label="Fire" count={1250} mine onToggle={noop} />
        <ReactionChip emoji="🔥" label="Fire" count={48213} onToggle={noop} />
      </Row>
      <Row label="Custom emoji, and one whose image is missing">
        <ReactionChip emoji=":partyparrot:" src={PARROT_SRC} label="partyparrot" count={7} mine onToggle={noop} />
        <ReactionChip emoji=":gone:" label="gone" count={1} onToggle={noop} />
      </Row>
      <Row label="Unavailable (no permission to react), busy (toggle in flight)">
        <ReactionChip emoji="👍" label="Thumbs up" count={2} aria-disabled onToggle={noop} />
        <ReactionChip emoji="👍" label="Thumbs up" count={3} mine busy onToggle={noop} />
      </Row>
      <Row label="Press to toggle">
        <Toggle />
      </Row>
    </div>
  </ChatColumn>
);

/** Mine and not mine, big counts, custom emoji, unavailable, busy and a live toggle. */
export const States = () => (
  <OnPalette palette={PALETTES[0]}>
    <Body />
  </OnPalette>
);

export const StatesLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Body />
  </OnPalette>
);

export const StatesTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Body />
  </OnPalette>
);
