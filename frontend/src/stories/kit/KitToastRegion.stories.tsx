import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import {
  AppFrame,
  Button,
  Card,
  Dialog,
  IconButton,
  Menu,
  SettingsLayout,
  StageLayout,
  Text,
  ThreeIslands,
  useToasts,
  useWidthRange,
  type ToastRequest,
} from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { KitFrameStage } from '../fixtures/kitStory';
import { FakeKeyboard } from '../fixtures/fakeKeyboard';
import {
  SampleCallBar,
  SampleChannels,
  SampleControls,
  SampleConversation,
  SampleDock,
  SampleRoleForm,
  SampleScreen,
  SampleSections,
  SampleUnsaved,
  SampleStageHeader,
  SampleStrip,
} from '../fixtures/layoutSamples';

/**
 * The toast host on the real templates: where the region sits (the bottom centre of the main island, above the
 * composer or the stage controls; on a phone above the call bar, the dock bar and the keyboard), how it looks over
 * a dialog, a sticky danger toast and a queue. Each story holds its toast on screen (showing it again before its
 * timer ends) so a screenshot always finds it; the buttons in the story show and dismiss more.
 */

const noop = () => undefined;

/** Shows `request` on mount and again before its timer ends, so it stays for a screenshot; dismissed on unmount. */
function HeldToast({ request }: { request: ToastRequest & { id: string } }): null {
  const toasts = useToasts();
  useEffect(() => {
    toasts.show(request);
    const again = setInterval(() => toasts.show(request), tokens.motion.toast / 2);
    return () => {
      clearInterval(again);
      toasts.dismiss(request.id);
    };
    // The request is a literal per story: show it once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);
  return null;
}

let count = 0;
/** Story controls: show a toast of each kind, and dismiss the one showing. */
function ToastControls(): JSX.Element {
  const toasts = useToasts();
  const [last, setLast] = useState<string | null>(null);
  const show = (request: ToastRequest) => setLast(toasts.show(request));
  return (
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: tokens.space.sm, alignItems: 'center' }}>
        <Text variant="small" tone="secondary">
          Toasts
        </Text>
        <Button size="sm" variant="soft" onClick={() => show({ message: `Copied link ${(count += 1)}` })}>
          Show
        </Button>
        <Button size="sm" variant="soft" onClick={() => show({ tone: 'positive', message: 'Saved' })}>
          Show success
        </Button>
        <Button
          size="sm"
          variant="soft"
          onClick={() => show({ message: 'Message deleted', action: { label: 'Undo', onAction: noop } })}
        >
          Show with Undo
        </Button>
        <Button
          size="sm"
          variant="soft"
          onClick={() =>
            show({ id: 'send', tone: 'danger', message: "Couldn't send", action: { label: 'Retry', onAction: noop } })
          }
        >
          Show danger with Retry
        </Button>
        <Button size="sm" variant="soft" disabled={last === null} onClick={() => last !== null && toasts.dismiss(last)}>
          Dismiss last
        </Button>
      </div>
    </Card>
  );
}

/** The conversation with the story controls above it. */
function Centre({ onBack, controls = true }: { onBack?: () => void; controls?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      {controls && (
        <div style={{ padding: `${tokens.space.md}px ${tokens.space.lg}px 0` }}>
          <ToastControls />
        </div>
      )}
      <SampleConversation rows={4} onBack={onBack} />
    </div>
  );
}

function Chat({
  mode,
  call = true,
  controls = true,
  children,
}: {
  mode: ModeName;
  call?: boolean;
  /** The story's show and dismiss buttons above the conversation. */
  controls?: boolean;
  children?: ReactNode;
}): JSX.Element {
  const range = useWidthRange();
  const [pane, setPane] = useState<'left' | 'centre'>('centre');
  return (
    <AppFrame>
      <ThreeIslands
        dock={<SampleDock />}
        left={<SampleChannels onPick={() => setPane('centre')} />}
        leftLabel="Channels"
        centre={<Centre controls={controls} onBack={range === 'phone' ? () => setPane('left') : undefined} />}
        centreLabel={`general in Couch Co-op (${mode})`}
        callBar={call ? <SampleCallBar /> : undefined}
        phonePane={pane}
      />
      {children}
    </AppFrame>
  );
}

const SAVED = { id: 'saved', tone: 'positive', message: 'Saved your changes' } as const;

/** In a call: the toast sits over the bottom of the conversation, above the composer; never over the call bar or the dock. */
export const InCall = () => (
  <KitFrameStage mode="dark">
    <Chat mode="dark">
      <HeldToast request={SAVED} />
    </Chat>
  </KitFrameStage>
);

export const InCallLight = () => (
  <KitFrameStage mode="light">
    <Chat mode="light">
      <HeldToast request={SAVED} />
    </Chat>
  </KitFrameStage>
);

/**
 * A phone with the on-screen keyboard up (faked: the visual viewport reports `KEYBOARD_SHARE` of the window less,
 * about 300 px on a 844 px phone). The frame ends at the keyboard, the dock bar is left out, and the toast sits
 * above the composer, which sits above the call bar. No story controls, so the composer keeps the room.
 */
export const PhoneKeyboard = () => (
  <FakeKeyboard>
    <KitFrameStage mode="dark">
      <Chat mode="dark" controls={false}>
        <HeldToast request={{ id: 'copied', message: 'Copied link to the clip' }} />
      </Chat>
    </KitFrameStage>
  </FakeKeyboard>
);

/** A failed send with Retry: a danger toast with an action stays until dismissed, and toasts behind it wait. */
export const StickyDanger = () => (
  <KitFrameStage mode="dark">
    <Chat mode="dark" call={false}>
      <HeldToast
        request={{
          id: 'send',
          tone: 'danger',
          message: "Couldn't send your message",
          action: { label: 'Retry', onAction: noop },
        }}
      />
    </Chat>
  </KitFrameStage>
);

export const StickyDangerLight = () => (
  <KitFrameStage mode="light">
    <Chat mode="light" call={false}>
      <HeldToast
        request={{
          id: 'send',
          tone: 'danger',
          message: "Couldn't send your message",
          action: { label: 'Retry', onAction: noop },
        }}
      />
    </Chat>
  </KitFrameStage>
);

/** Several at once: one shows, the rest wait (a success that waits longer than 8 s is dropped). */
function Queue(): null {
  const toasts = useToasts();
  useEffect(() => {
    toasts.show({ id: 'q-undo', message: 'Message deleted', action: { label: 'Undo', onAction: noop } });
    toasts.show({ id: 'q-pinned', message: 'Pinned to the channel' });
    toasts.show({ id: 'q-upload', tone: 'danger', message: "Couldn't upload clip.mp4" });
  }, [toasts]);
  return null;
}

export const Queued = () => (
  <KitFrameStage mode="dark">
    <Chat mode="dark">
      <Queue />
    </Chat>
  </KitFrameStage>
);

/**
 * Under an open dialog: the toast stays on the dimmed page under the dialog, seen but out of reach (the dialog hides
 * the page from the keyboard and screen readers) and its timer is held. It is announced inside the dialog.
 */
function DialogOver(): JSX.Element {
  const toasts = useToasts();
  const [open, setOpen] = useState(true);
  return (
    <>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Notification settings"
        description="Toasts shown now wait on the dimmed page until this closes."
        actions={
          <>
            <Button
              variant="soft"
              onClick={() => {
                // In place of the toast already showing, so it shows (and is announced) now rather than waiting.
                toasts.dismiss('under');
                toasts.show({ id: 'from-dialog', tone: 'positive', message: 'Notifications muted for 1 hour' });
              }}
            >
              Show a toast
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </>
        }
      />
      <HeldToast request={{ id: 'under', message: '2 new messages in #clips' }} />
    </>
  );
}

export const UnderDialog = () => (
  <KitFrameStage mode="dark">
    <Chat mode="dark">
      <DialogOver />
    </Chat>
  </KitFrameStage>
);

/** The call stage: the toast sits above the controls. */
export const OnStage = () => (
  <KitFrameStage mode="dark">
    <AppFrame>
      <StageLayout
        header={<SampleStageHeader />}
        stage={<SampleScreen />}
        strip={<SampleStrip />}
        controls={<SampleControls />}
        stageLabel="Squad Up"
      />
      <HeldToast request={{ id: 'joined', message: 'pri joined the call' }} />
    </AppFrame>
  </KitFrameStage>
);

/**
 * A menu opened upwards from beside the composer while a toast shows: every overlay is drawn over the toast, so
 * its bottom rows stay readable and pressable.
 */
function ComposerMenu(): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(true);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => setAnchor(button.current), []);
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: tokens.space.xl * 3, transform: 'translateX(-50%)' }}>
      <IconButton ref={button} icon="Plus" label="Add to message" variant="soft" onClick={() => setOpen(true)} />
      <Menu
        open={open && anchor !== null}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label="Add to message"
        placement="top-start"
        items={[
          { id: 'file', label: 'Upload a file', icon: 'Paperclip', onSelect: noop },
          { id: 'poll', label: 'Start a poll', icon: 'LayoutGrid', onSelect: noop },
          { id: 'clip', label: 'Share a clip', icon: 'Image', onSelect: noop },
        ]}
      />
    </div>
  );
}

export const MenuOverToast = () => (
  <KitFrameStage mode="dark">
    <Chat mode="dark" call={false}>
      <HeldToast request={{ id: 'copied', message: 'Copied link to the clip' }} />
      <ComposerMenu />
    </Chat>
  </KitFrameStage>
);

/**
 * Settings: a toast shows, then the unsaved-changes bar appears under it (press Make a change). The toast moves
 * up above the bar, so Save and Reset are never covered.
 */
function SettingsWithFooter({ startDirty = false }: { startDirty?: boolean }): JSX.Element {
  const [dirty, setDirty] = useState(startDirty);
  return (
    <AppFrame>
      <SettingsLayout
        title="Community settings"
        nav={<SampleSections />}
        navLabel="Community settings sections"
        footer={dirty ? <SampleUnsaved /> : undefined}
        phonePane="content"
        onBack={noop}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
          <div>
            <Button variant="soft" onClick={() => setDirty(!dirty)}>
              {dirty ? 'Undo the change' : 'Make a change'}
            </Button>
          </div>
          <SampleRoleForm />
        </div>
      </SettingsLayout>
      <HeldToast request={{ id: 'role-saved', tone: 'positive', message: 'Role colour updated' }} />
    </AppFrame>
  );
}

export const SettingsFooterAppears = () => (
  <KitFrameStage mode="dark">
    <SettingsWithFooter />
  </KitFrameStage>
);

export const SettingsWithUnsavedFooter = () => (
  <KitFrameStage mode="dark">
    <SettingsWithFooter startDirty />
  </KitFrameStage>
);

