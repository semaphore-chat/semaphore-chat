import { useState, type JSX } from 'react';
import { Button, ConfirmDialog, Menu, Popover, Text, useConfirmDestructive, type ConfirmDialogProps } from '../../kit';
import { ToastRegion } from '../../kit/display/ToastRegion';
import { tokens } from '../../theme/generated/tokens';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitStage } from '../fixtures/kitStory';
import { PageBehind } from './kitOverlayAnchor';
import { useAnchor } from './useAnchor';

const noop = () => undefined;

const COPY = {
  title: 'Delete #memes?',
  description: "This removes the channel and its 1,204 messages for everyone in Couch Co-op. This can't be undone.",
  confirmLabel: 'Delete channel',
};

/** One phase of the dialog, drawn without running anything. */
function Phase({ mode, ...props }: Partial<ConfirmDialogProps> & { mode: ModeName; phase: ConfirmDialogProps['phase'] }) {
  return (
    <KitStage mode={mode}>
      <PageBehind />
      <ConfirmDialog error={null} {...COPY} onConfirm={noop} onCancel={noop} onPresence={noop} {...props} />
    </KitStage>
  );
}

/** Asking: Cancel first with focus, the danger action second. */
export const Confirming = () => <Phase mode="dark" phase="confirming" />;

export const ConfirmingLight = () => <Phase mode="light" phase="confirming" />;

/** The action is running: the confirm button is busy, Cancel reads unavailable (both stay focusable), nothing closes it. */
export const Working = () => <Phase mode="dark" phase="working" />;

export const WorkingLight = () => <Phase mode="light" phase="working" />;

/** The action failed: the error shows as an alert in the body, the label stays, Cancel is back. */
export const Failed = () => (
  <Phase mode="dark" phase="failed" error="Couldn't delete the channel. Check your connection and try again." />
);

export const FailedLight = () => (
  <Phase mode="light" phase="failed" error="Couldn't delete the channel. Check your connection and try again." />
);

/** A long error and a long name: the dialog wraps, the alert wraps, nothing is clipped. Judge at 390 px. */
/** The action timed out: the result is unknown, so the message says to check first; the same button retries. */
export const TimedOut = () => (
  <Phase mode="dark" phase="failed" error="This is taking too long. It may still have worked, so check before you try again." />
);

export const FailedLongText = () => (
  <Phase
    mode="dark"
    phase="failed"
    title="Delete #announcements-and-everything-else-the-moderators-pinned-for-the-whole-community?"
    error="Couldn't delete the channel. The server answered after a very long wait with a message that does not fit on one line, so it wraps. Check your connection and try again."
  />
);

function Log({ lines, phase }: { lines: string[]; phase: string }): JSX.Element {
  return (
    <div data-testid="confirm-log" data-phase={phase}>
      <Text tone="secondary">{lines.length === 0 ? 'Nothing yet.' : lines.slice(-3).join(' · ')}</Text>
    </div>
  );
}

/** A channel's options menu whose Delete item opens the confirmation. `run` decides how the action ends. */
function FromMenuScreen({ run }: { run: (attempt: number) => Promise<void> }) {
  const [anchor, ref] = useAnchor();
  const [menu, setMenu] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const remove = useConfirmDestructive({
    ...COPY,
    run: () => {
      const attempt = attempts + 1;
      setAttempts(attempt);
      return run(attempt);
    },
    errorMessage: () => "Couldn't delete the channel. Check your connection and try again.",
    onDone: () => setLines((previous) => [...previous, 'channel deleted']),
  });
  return (
    <>
      <Log lines={lines} phase={remove.phase} />
      <div style={{ display: 'flex', gap: tokens.space.sm }}>
        <Button ref={ref} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(true)}>
          Channel options
        </Button>
        <Menu
          open={menu}
          anchor={anchor}
          onClose={() => setMenu(false)}
          label="Channel options"
          items={[
            { id: 'mute', label: 'Mute channel', icon: 'BellOff', onSelect: noop },
            { id: 'd1', divider: true },
            { id: 'delete', label: 'Delete channel…', icon: 'Trash2', tone: 'danger', onSelect: remove.request },
          ]}
        />
      </div>
      {remove.dialog}
    </>
  );
}

const after = (ms: number, fail: boolean) =>
  new Promise<void>((resolve, reject) => setTimeout(() => (fail ? reject(new Error('503')) : resolve()), ms));

/** Open the menu, choose Delete channel…. The first try fails after a moment, the second works. Focus goes back to the menu's button. */
export const FromMenu = () => (
  <KitStage mode="dark">
    <PageBehind />
    <FromMenuScreen run={(attempt) => after(1200, attempt === 1)} />
  </KitStage>
);

/** The same menu, but the action never ends: it stays working (the browser tests press Escape in it). */
export const FromMenuNeverEnds = () => (
  <KitStage mode="dark">
    <PageBehind />
    <FromMenuScreen run={() => new Promise<void>(() => undefined)} />
  </KitStage>
);

function PanelScreen(): JSX.Element {
  const [anchor, ref] = useAnchor();
  const [panel, setPanel] = useState(true);
  const remove = useConfirmDestructive({
    ...COPY,
    // While it works, the panel the dialog lives in closes (a socket event, say); then the server says no.
    run: () => {
      setTimeout(() => setPanel(false), 400);
      return after(1200, true);
    },
    errorMessage: () => "Couldn't delete #memes. Try again.",
  });
  return (
    <>
      <div>
        <Button ref={ref} onClick={() => setPanel(true)}>
          Channel settings
        </Button>
      </div>
      <Popover open={panel} anchor={anchor} onClose={() => setPanel(false)} label="Channel settings">
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm, padding: tokens.space.md }}>
          <Text tone="secondary">Deleting removes the channel for everyone.</Text>
          <Button variant="danger" onClick={remove.request}>
            Delete channel…
          </Button>
        </div>
        {remove.dialog}
      </Popover>
      <ToastRegion />
    </>
  );
}

/**
 * The dialog lives in a panel that closes while the action works. The dialog goes with it; the failure that follows
 * shows as a danger toast from the real toast host, and Delete works again.
 */
export const ParentClosesThenFails = () => (
  <KitStage mode="dark">
    <PageBehind />
    <PanelScreen />
  </KitStage>
);
