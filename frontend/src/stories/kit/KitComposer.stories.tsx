import { useState } from 'react';
import { Composer, IconButton, Pill, type ComposerProps } from '../../kit';
import { Row } from '../fixtures/kitStory';
import { ChatColumn, OnPalette } from './kitChatFixtures';
import { PALETTES, noop } from './kitChatData';

type Shown = Partial<ComposerProps> & { initial?: string };

/** A composer with its own draft, so a story can be typed into. */
const Live = ({ initial = '', ...props }: Shown) => {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      label="Message #general"
      value={value}
      onChange={setValue}
      onSubmit={() => setValue('')}
      onAttach={noop}
      emoji={<IconButton icon="Smile" variant="soft" label="Emoji" onClick={noop} />}
      {...props}
    />
  );
};

const MANY_LINES = Array.from({ length: 14 }, (_, index) => `line ${index + 1} of a long draft`).join('\n');

const STATES: { label: string; props: Shown }[] = [
  { label: 'Empty: Send reads as unavailable', props: {} },
  { label: 'Typing', props: { initial: 'same time tomorrow?' } },
  { label: 'Multi-line at the cap (desktop: 10 rows, then it scrolls)', props: { initial: MANY_LINES } },
  { label: 'Phone cap (4 rows)', props: { initial: MANY_LINES, cap: 'phone' } },
  { label: 'Keyboard cap (2 rows, the on-screen keyboard is up)', props: { initial: MANY_LINES, cap: 'keyboard' } },
  {
    label: 'Reply banner',
    props: {
      initial: 'on it',
      banner: { kind: 'reply', title: 'Replying to aiko', detail: 'you still have my headset btw', cancelLabel: 'Cancel reply', onCancel: noop },
    },
  },
  {
    label: 'Editing banner, save mode: "Save changes" with a check',
    props: {
      initial: "yeah i'll bring it friday",
      mode: 'save',
      banner: { kind: 'editing', title: 'Editing message', detail: 'Escape to cancel, Enter to save', cancelLabel: 'Cancel editing', onCancel: noop },
    },
  },
  { label: 'Save mode with nothing changed yet: unavailable', props: { initial: '', mode: 'save', onSendUnavailablePress: noop } },
  { label: 'Inline (inside a message row: no padding, no toast clearance)', props: { initial: 'edited in place', inline: true, mode: 'save' } },
  {
    label: 'Attachments tray',
    props: {
      canSend: true,
      attachments: (
        <>
          <Pill icon="Image">deep-dive-clip.png</Pill>
          <Pill icon="Paperclip">notes.txt</Pill>
        </>
      ),
    },
  },
  { label: 'Sending: Send is busy, the field stays editable', props: { initial: 'on its way', sending: true } },
  { label: 'Attach unavailable (no permission to attach): a press says why', props: { attachUnavailable: true, onAttachUnavailablePress: noop } },
  { label: 'Notice: no permission', props: { notice: { text: "You can't send messages in #announcements", icon: 'Lock' } } },
  { label: 'Notice: timed out', props: { notice: { text: "You're timed out for 4 more minutes", icon: 'Shield' } } },
  { label: 'Notice: read only', props: { notice: { text: 'This channel is read only', icon: 'Eye' } } },
];

const Body = () => (
  <>
    {STATES.map((state) => (
      <Row key={state.label} label={state.label}>
        <ChatColumn>
          <Live {...state.props} />
        </ChatColumn>
      </Row>
    ))}
  </>
);

/**
 * Empty, typing, the three caps, reply and editing banners, save mode, inline, attachments, sending, attach
 * unavailable, and the three notices.
 */
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

/** One composer at the desktop cap, for the real-browser test of how far it grows. */
export const AtCap = () => (
  <OnPalette palette={PALETTES[0]}>
    <ChatColumn>
      <Live initial={MANY_LINES} />
    </ChatColumn>
  </OnPalette>
);

/** One composer at the phone cap (4 lines), for the real-browser test. */
export const AtPhoneCap = () => (
  <OnPalette palette={PALETTES[0]}>
    <ChatColumn>
      <Live initial={MANY_LINES} cap="phone" />
    </ChatColumn>
  </OnPalette>
);

/** One composer at the keyboard cap (2 lines, with the on-screen keyboard up), for the real-browser test. */
export const AtKeyboardCap = () => (
  <OnPalette palette={PALETTES[0]}>
    <ChatColumn>
      <Live initial={MANY_LINES} cap="keyboard" />
    </ChatColumn>
  </OnPalette>
);
