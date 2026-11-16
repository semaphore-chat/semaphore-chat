import { ListSeparator, MessageRow, MessageText } from '../../kit';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, text } from './kitChatData';

const Body = () => (
  <ChatColumn>
    <ListSeparator variant="day" label="Yesterday" />
    <MessageRow author="kwam3" avatarColour="#6FB1F5" time="11:58 PM" body={<MessageText segments={text('night all')} />} />
    <ListSeparator variant="day" label="Today" />
    <MessageRow author="aiko" avatarColour="#FF8FB8" time="8:19 PM" body={<MessageText segments={text('read this one')} />} />
    <ListSeparator variant="unread" label="New" />
    <MessageRow author="dropbear" avatarColour="#5FD49A" time="8:21 PM" body={<MessageText segments={text('the first one not read yet')} />} />
    <ListSeparator variant="day" label="Wednesday 11 November 2026, a long day label that has to give way on a narrow phone" />
  </ChatColumn>
);

/** The day separator ("Today") and the unread separator ("New") in a conversation, and a long day label. */
export const Variants = () => (
  <OnPalette palette={PALETTES[0]}>
    <Body />
  </OnPalette>
);

export const VariantsLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Body />
  </OnPalette>
);

export const VariantsTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Body />
  </OnPalette>
);
