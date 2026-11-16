import { TypingLine } from '../../kit';
import { Row } from '../fixtures/kitStory';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES } from './kitChatData';

const Body = () => (
  <ChatColumn width={390}>
    <Row label="One">
      <TypingLine names={['aiko']} />
    </Row>
    <Row label="Two">
      <TypingLine names={['aiko', 'dropbear']} />
    </Row>
    <Row label="Many">
      <TypingLine names={['aiko', 'dropbear', 'gracie', 'kwam3']} />
    </Row>
    <Row label="A long name gives way">
      <TypingLine names={['a display name that is much too long for a phone column to show', 'dropbear']} />
    </Row>
  </ChatColumn>
);

/** Who is typing: one, two, many, a long name at phone width. */
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
