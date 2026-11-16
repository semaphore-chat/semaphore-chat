import { Button, Card, Icon, IconButton, MessageRow, MessageText, ReactionChip, Stack, Text } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, noop, text } from './kitChatData';

const Quote = ({ author, line }: { author: string; line: string }) => (
  <div
    style={{
      display: 'flex',
      gap: tokens.space.sm,
      alignItems: 'baseline',
      minWidth: 0,
      paddingInlineStart: tokens.space.sm,
      borderInlineStart: `${tokens.border.selected}px solid currentColor`,
    }}
  >
    <Text variant="meta" tone="secondary">
      {author}
    </Text>
    <Text variant="meta" tone="dim" truncate>
      {line}
    </Text>
  </div>
);

const Attachment = ({ name }: { name: string }) => (
  <div style={{ maxWidth: 420 }}>
    <Card padding="md">
      <Stack direction="row" gap="sm">
        <Icon name="Image" tone="accent" />
        <Text variant="meta" truncate>
          {name}
        </Text>
      </Stack>
    </Card>
  </div>
);

const Replies = ({ count }: { count: number }) => (
  <Button variant="text" size="sm" startIcon={<Icon name="MessageSquare" size="sm" />} onClick={noop}>
    {`${count} replies`}
  </Button>
);

const REACTIONS = [
  { emoji: '😂', label: 'Laugh', count: 4, mine: true },
  { emoji: '🔥', label: 'Fire', count: 2 },
  { emoji: '👍', label: 'Thumbs up', count: 1 },
];

const MANY = ['😂', '🔥', '👍', '🎉', '❤️', '😮', '😢', '🙏', '👀', '💯', '🚀', '🤔', '😅', '🍕', '🎮', '⭐'];

const Conversation = () => (
  <ChatColumn>
    <MessageRow author="aiko" avatarColour="#FF8FB8" time="8:19 PM" timeLabel="Monday 16 November 2026, 8:19 PM" onOpenAuthor={noop} body={<MessageText segments={[{ type: 'mention', kind: 'user', text: '@dropbear', id: 'u2' }, { type: 'text', text: ' you still have my headset btw' }]} />} />
    <MessageRow author="aiko" avatarColour="#FF8FB8" time="8:19 PM" continued body={<MessageText segments={text('first of a group above, this one is continued')} />} />
    <MessageRow author="dropbear" avatarColour="#5FD49A" time="8:21 PM" mentioned onOpenAuthor={noop} body={<MessageText segments={[{ type: 'mention', kind: 'user', text: '@alexk', me: true }, { type: 'text', text: " yeah i'll bring it friday" }]} />} />
    <MessageRow author="gracie" avatarColour="#FFA366" time="8:22 PM" highlighted edited pinned body={<MessageText segments={text('the jump target: highlighted, edited and pinned')} />} />
    <MessageRow
      author="gracie"
      avatarColour="#FFA366"
      time="8:22 PM"
      continued
      quote={<Quote author="kwam3" line="ok that run was cursed, same time tomorrow?" />}
      attachments={<Attachment name="deep-dive-clip.png" />}
      body={<MessageText segments={text('found this from last time')} />}
      reactions={REACTIONS.map((reaction) => <ReactionChip key={reaction.label} {...reaction} onToggle={noop} />)}
      footer={<Replies count={3} />}
    />
    <MessageRow author="alexk" avatarColour="#9AA0FF" time="8:24 PM" state="pending" body={<MessageText segments={text('on its way to the server')} />} />
    <MessageRow author="alexk" avatarColour="#9AA0FF" time="8:24 PM" continued state="failed" onRetry={noop} onDelete={noop} body={<MessageText segments={text('this one did not make it')} />} />
  </ChatColumn>
);

/** A conversation with every row state: first of a group, continued, mentioned, highlighted, edited and pinned, quote, attachment, reactions, thread footer, pending and failed. */
export const States = () => (
  <OnPalette palette={PALETTES[0]}>
    <Conversation />
  </OnPalette>
);

export const StatesLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <Conversation />
  </OnPalette>
);

export const StatesTinted = () => (
  <OnPalette palette={PALETTES[2]}>
    <Conversation />
  </OnPalette>
);

const LONG_NAME = 'Bartholomew Montgomery-Fitzwilliam the Third, Keeper of the Couch';
const UNBROKEN = 'a'.repeat(30) + 'https://example.com/' + 'x'.repeat(160);

const LongBody = () => (
  <ChatColumn>
    <MessageRow author={LONG_NAME} avatarColour="#6FB1F5" time="Yesterday 11:58 PM" edited pinned onOpenAuthor={noop} body={<MessageText segments={text('a very long name gives way with an ellipsis; the time stays')} />} />
    <MessageRow author="kwam3" avatarColour="#6FB1F5" time="8:23 PM" body={<MessageText segments={text(UNBROKEN)} />} />
    <MessageRow
      author="pri"
      avatarColour="#C792F0"
      time="8:24 PM"
      body={
        <MessageText
          segments={[
            { type: 'text', text: 'the config that fixed it:' },
            { type: 'codeBlock', text: 'livekit:\n  rtc:\n    use_external_ip: true\n    port_range_start: 50000\n    port_range_end: 60000 # a long comment line that wraps instead of scrolling sideways on a phone' },
          ]}
        />
      }
    />
    <MessageRow
      author="aiko"
      avatarColour="#FF8FB8"
      time="8:25 PM"
      body={<MessageText segments={text('so many reactions they wrap')} />}
      reactions={MANY.map((emoji, index) => (
        <ReactionChip key={emoji} emoji={emoji} label={`Reaction ${index + 1}`} count={index * 7 + 1} mine={index % 5 === 0} onToggle={noop} />
      ))}
    />
  </ChatColumn>
);

/** Long content: a very long name, a very long unbroken run, a code block and many reactions wrapping. */
export const LongContent = () => (
  <OnPalette palette={PALETTES[0]}>
    <LongBody />
  </OnPalette>
);

export const LongContentLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <LongBody />
  </OnPalette>
);

const ActionsBody = () => (
  <ChatColumn>
    <div style={{ height: tokens.space.xl }} />
    <MessageRow
      author="gracie"
      avatarColour="#FFA366"
      time="8:22 PM"
      onOpenActions={noop}
      focus={{ tabStop: true }}
      actions={
        <>
          <IconButton icon="Smile" size="sm" label="Add reaction" onClick={noop} />
          <IconButton icon="Reply" size="sm" label="Reply" onClick={noop} />
          <IconButton icon="Ellipsis" size="sm" label="More actions" onClick={noop} />
        </>
      }
      body={<MessageText segments={text('hover me, or Tab to me: the toolbar shows')} />}
    />
    <MessageRow author="gracie" avatarColour="#FFA366" time="8:22 PM" continued focus={{ tabStop: false }} body={<MessageText segments={text('a continued row: its time shows in the gutter on hover and focus')} />} />
  </ChatColumn>
);

/** The hover and focus toolbar (compact and wide) and a continued row's gutter time. */
export const Actions = () => (
  <OnPalette palette={PALETTES[0]}>
    <ActionsBody />
  </OnPalette>
);

export const ActionsLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <ActionsBody />
  </OnPalette>
);
