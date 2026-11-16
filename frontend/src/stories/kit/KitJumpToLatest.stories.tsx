import type { ReactNode } from 'react';
import { JumpToLatest, MessageRow, MessageText } from '../../kit';
import { Row } from '../fixtures/kitStory';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, noop, text } from './kitChatData';

/** A list region (the positioned container the control floats in) with a few rows under it. */
const Region = ({ children }: { children: ReactNode }) => (
  <div style={{ width: 360, maxWidth: '100%' }}>
    <ChatColumn width={360}>
      <div style={{ position: 'relative', height: 220, overflow: 'hidden' }}>
        <MessageRow author="aiko" avatarColour="#FF8FB8" time="8:19 PM" body={<MessageText segments={text('scrolled up a little')} />} />
        <MessageRow author="dropbear" avatarColour="#5FD49A" time="8:21 PM" body={<MessageText segments={text('the newest are further down')} />} />
        <MessageRow author="gracie" avatarColour="#FFA366" time="8:22 PM" body={<MessageText segments={text('the control floats over the rows')} />} />
        {children}
      </div>
    </ChatColumn>
  </div>
);

const Body = () => (
  <>
    <Row label="Plain">
      <Region>
        <JumpToLatest onJump={noop} />
      </Region>
    </Row>
    <Row label="With a count">
      <Region>
        <JumpToLatest onJump={noop} newCount={3} />
      </Region>
    </Row>
    <Row label="Over 99">
      <Region>
        <JumpToLatest onJump={noop} newCount={240} />
      </Region>
    </Row>
    <Row label="Busy (loading the latest)">
      <Region>
        <JumpToLatest onJump={noop} busy />
      </Region>
    </Row>
  </>
);

/** Plain, with "N new", over 99 ("99+ new") and busy, each floating over a list region. */
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
