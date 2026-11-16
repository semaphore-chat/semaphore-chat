import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  AttachmentTile,
  ChatPane,
  Composer,
  IconButton,
  Island,
  JumpToLatest,
  ListSeparator,
  MessageRow,
  MessageText,
  Text,
  TypingLine,
} from '../../kit';
import MessageListCore, { type MessageRowContext } from '../../features/chat/MessageListCore';
import type { Message } from '../../types/message.type';
import { EMPTY_MESSAGE_FIELDS } from '../../types/message.type';
import { OnPalette } from './kitChatFixtures';
import { PALETTES, noop, text } from './kitChatData';

/** A centre island of a phone's size: the pane fills it. */
const Frame = ({ children, height = 640 }: { children: ReactNode; height?: number }) => (
  <div style={{ width: 390, maxWidth: '100%', height }}>
    <Island as="div" padding="none" scroll>
      {children}
    </Island>
  </div>
);

const Header = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8 }}>
    <IconButton icon="ArrowLeft" label="Back" onClick={noop} />
    <Text variant="title" as="h1" truncate>
      # lobby
    </Text>
  </div>
);

const Rows = () => (
  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 32 }}>
    <ListSeparator variant="day" label="Today" />
    {['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'].map((word, i) => (
      <MessageRow key={word} author={i % 2 ? 'aiko' : 'dropbear'} avatarColour={i % 2 ? '#FF8FB8' : '#5FD49A'} time={`8:${10 + i} PM`} body={<MessageText segments={text(`the ${word} message of a busy evening`)} />} />
    ))}
    <ListSeparator variant="unread" label="New" />
    <MessageRow author="gracie" avatarColour="#FFA366" time="8:30 PM" body={<MessageText segments={text('the first one not read yet')} />} />
  </div>
);

const Body = ({ composer }: { composer: boolean }) => (
  <Frame>
    <ChatPane
      header={<Header />}
      list={<Rows />}
      typing={<TypingLine names={['aiko', 'dropbear']} />}
      jump={<JumpToLatest onJump={noop} newCount={3} />}
      announcement="3 new messages"
      composer={composer ? <Composer label="Message #lobby" value="" onChange={noop} onSubmit={noop} cap="phone" /> : undefined}
    />
  </Frame>
);

/** Header, list with day and unread separators, the typing line and Jump to latest floating over its bottom. */
export const Conversation = () => (
  <OnPalette palette={PALETTES[0]}>
    <Body composer={false} />
  </OnPalette>
);

export const ConversationLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Body composer={false} />
  </OnPalette>
);

export const ConversationTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Body composer={false} />
  </OnPalette>
);

/** With a composer under the list (the composer arrives with the chat's second step). */
export const WithComposer = () => (
  <OnPalette palette={PALETTES[0]}>
    <Body composer />
  </OnPalette>
);

const COUNT = 2000;
const START = Date.UTC(2026, 10, 1, 12, 0, 0);
const AUTHORS = ['aiko', 'dropbear', 'gracie', 'kwam3'];
const COLOURS = ['#FF8FB8', '#5FD49A', '#FFA366', '#6FB1F5'];
const picture =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#6FB1F5"/></svg>');

function longHistory(): Message[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    ...EMPTY_MESSAGE_FIELDS,
    id: `m-${i}`,
    channelId: 'c-1',
    authorId: AUTHORS[Math.floor(i / 3) % AUTHORS.length],
    sentAt: new Date(START + i * 7 * 60_000).toISOString(),
    spans: [{ type: 'PLAINTEXT', text: `message ${i}: ${'words that fill a line or two of a phone column '.repeat((i % 3) + 1)}` }],
    attachments:
      i % 10 === 0
        ? [{ id: `f-${i}`, filename: `shot-${i}.png`, fileType: 'IMAGE', size: 1024, width: 1600, height: 900 } as Message['attachments'][number]]
        : [],
    reactions: [],
  })) as Message[];
}

function LongRow({ message, ctx }: { message: Message; ctx: MessageRowContext }) {
  const who = AUTHORS.indexOf(message.authorId ?? '');
  return (
    <>
      {ctx.showDaySeparator && <ListSeparator variant="day" label={new Date(message.sentAt).toDateString()} />}
      <MessageRow
        author={message.authorId ?? ''}
        avatarColour={COLOURS[who]}
        time={new Date(message.sentAt).toISOString().slice(11, 16)}
        continued={ctx.grouped}
        body={<MessageText segments={text(message.spans[0]?.text ?? '')} />}
        attachments={
          message.attachments.length > 0 ? (
            <AttachmentTile kind="image" name={message.attachments[0].filename} src={picture} width={1600} height={900} onOpen={noop} />
          ) : undefined
        }
        focus={{ tabStop: ctx.isRovingFocused, onKeyDown: (e) => ctx.onRovingKeyDown(e as never, ctx.index), onFocus: () => ctx.onRovingFocus(ctx.index) }}
      />
    </>
  );
}

/** 2,000 kit rows (200 with sized images) on the shared list core: the long-list performance check. */
export const LongHistory = () => {
  const messages = useMemo(longHistory, []);
  const [atBottom, setAtBottom] = useState(true);
  const renderRow = useCallback((message: Message, ctx: MessageRowContext) => <LongRow message={message} ctx={ctx} />, []);
  return (
    <OnPalette palette={PALETTES[0]}>
      <Frame height={700}>
        <ChatPane
          header={<Header />}
          list={
            <MessageListCore
              orderedMessages={messages}
              renderRow={renderRow}
              isLoadingMore={false}
              unreadCount={0}
              lastReadIndex={-1}
              resetKey="c-1"
              onAtBottomChange={setAtBottom}
            />
          }
          jump={atBottom ? undefined : <JumpToLatest onJump={noop} />}
        />
      </Frame>
    </OnPalette>
  );
};
