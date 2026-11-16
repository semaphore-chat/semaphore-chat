import { useState } from 'react';
import { Button, Card, Composer, Icon, IconButton, Menu, MessageRow, MessageText, ReactionChip, Stack, Text } from '../../kit';
import { useAnchor } from './useAnchor';
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
    <MessageRow author="alexk" avatarColour="#9AA0FF" time="8:25 PM" continued state="failed" failedReason="Timed out until 8:40 PM" onRetry={noop} onDelete={noop} body={<MessageText segments={text('failed with a reason from the server')} />} />
    <MessageRow
      author="alexk"
      avatarColour="#9AA0FF"
      time="8:25 PM"
      continued
      state="failed"
      failedReason="The server could not store this message because the channel was deleted while it was on its way"
      retrying
      onRetry={noop}
      onDelete={noop}
      body={<MessageText segments={text('a long reason wraps; Retry is busy while the retry is on its way')} />}
    />
  </ChatColumn>
);

/**
 * A conversation with every row state: first of a group, continued, mentioned, highlighted, edited and pinned,
 * quote, attachment, reactions, thread footer, pending, failed, failed with a reason, and retrying.
 */
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

/** A message being edited in place: an inline Composer in save mode as the row's body. */
const InlineEditor = ({ initial, cap }: { initial: string; cap?: 'keyboard' | 'phone' | 'desktop' }) => {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      inline
      mode="save"
      cap={cap}
      label="Edit message"
      value={value}
      onChange={setValue}
      onSubmit={noop}
      banner={{ kind: 'editing', title: 'Editing message', detail: 'Escape to cancel, Enter to save', cancelLabel: 'Cancel editing', onCancel: noop }}
    />
  );
};

const EditingBody = () => (
  <ChatColumn>
    <MessageRow author="kwam3" avatarColour="#6FB1F5" time="8:20 PM" body={<MessageText segments={text('ok that run was cursed, same time tomorrow?')} />} />
    <MessageRow author="alexk" avatarColour="#9AA0FF" time="8:21 PM" onOpenAuthor={noop} body={<InlineEditor initial="yeah i'll bring it friday" />} />
    <MessageRow author="alexk" avatarColour="#9AA0FF" time="8:21 PM" continued body={<InlineEditor initial={'a longer edit\nover a few lines\nstill inside the row\nand past the phone cap\nso it scrolls'} cap="phone" />} />
    <MessageRow author="dropbear" avatarColour="#5FD49A" time="8:22 PM" body={<MessageText segments={text('the rows around an editor stay as they are')} />} />
  </ChatColumn>
);

/** Editing in place: the row's body is an inline Composer (`mode="save"`, no toast clearance), short and capped. */
export const Editing = () => (
  <OnPalette palette={PALETTES[0]}>
    <EditingBody />
  </OnPalette>
);

export const EditingLight = () => (
  <OnPalette palette={PALETTES[1]}>
    <EditingBody />
  </OnPalette>
);

/** A row toolbar whose "More actions" opens a Menu (in a portal, outside the row). */
const Toolbar = () => {
  const [anchor, ref] = useAnchor();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="Smile" size="sm" label="Add reaction" onClick={noop} />
      <IconButton icon="Reply" size="sm" label="Reply" onClick={noop} />
      <IconButton
        ref={ref}
        icon="Ellipsis"
        size="sm"
        label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label="Message actions"
        items={[
          { id: 'pin', label: 'Pin message', icon: 'Pin', onSelect: noop },
          { id: 'copy', label: 'Copy link', icon: 'Link', onSelect: noop },
        ]}
      />
    </>
  );
};

/**
 * Three rows with toolbars, the first the list's Tab stop, then a button after the list: Tab from the row walks
 * that row's toolbar and then leaves, never the hidden toolbars of the other rows (the real-browser test). "More
 * actions" opens a Menu: the toolbar stays while it is open, so Escape returns focus to the button.
 */
export const ToolbarTabOrder = () => (
  <OnPalette palette={PALETTES[0]}>
    <ChatColumn>
      <div style={{ height: tokens.space.xl }} />
      {['first', 'second', 'third'].map((which, index) => (
        <MessageRow
          key={which}
          author="gracie"
          avatarColour="#FFA366"
          time={`8:2${index} PM`}
          continued={index > 0}
          onOpenActions={noop}
          focus={{ tabStop: index === 0 }}
          actions={<Toolbar />}
          body={<MessageText segments={text(`the ${which} row`)} />}
        />
      ))}
      <div style={{ padding: tokens.space.md }}>
        <Button variant="soft" onClick={noop}>
          After the list
        </Button>
      </div>
    </ChatColumn>
  </OnPalette>
);
