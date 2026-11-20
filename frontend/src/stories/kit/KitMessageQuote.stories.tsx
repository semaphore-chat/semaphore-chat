import { MessageQuote, MessageRow, MessageText } from '../../kit';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, noop, text } from './kitChatData';

const Body = () => (
  <ChatColumn width={390}>
    <MessageRow
      author="dropbear"
      avatarColour="#5FD49A"
      time="8:21 PM"
      quote={<MessageQuote author="kwam3" line="ok that run was cursed, same time tomorrow?" onOpen={noop} />}
      body={<MessageText segments={text('yes, 9 sharp')} />}
    />
    <MessageRow
      author="aiko"
      avatarColour="#FF8FB8"
      time="8:22 PM"
      quote={
        <MessageQuote
          author="a display name that is much too long for a phone column"
          line="and a line that is also far too long to fit on one line of a narrow phone column, so it gives way"
          onOpen={noop}
        />
      }
      body={<MessageText segments={text('long author, long line')} />}
    />
    <MessageRow
      author="gracie"
      avatarColour="#FFA366"
      time="8:23 PM"
      quote={<MessageQuote author="kwam3" line="" deleted />}
      body={<MessageText segments={text('replying to a message that is gone')} />}
    />
    <MessageRow
      author="gracie"
      avatarColour="#FFA366"
      time="8:24 PM"
      quote={<MessageQuote author="kwam3" line="no way to open this one" />}
      body={<MessageText segments={text('a plain quote (nothing to open)')} />}
    />
  </ChatColumn>
);

/** A reply's quote above its words: pressable, long author and line, deleted original, plain. */
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
