import { useEffect, useRef } from 'react';
import { IconButton, Tooltip } from '../../kit';
import type { IconName } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';

const PLACEMENTS = [
  { placement: 'top', icon: 'Mic', label: 'Mute microphone' },
  { placement: 'bottom', icon: 'Bell', label: 'Notification settings' },
  { placement: 'left', icon: 'Settings', label: 'Settings' },
  { placement: 'right', icon: 'Pin', label: 'Pinned messages' },
] as const satisfies readonly { placement: 'top' | 'bottom' | 'left' | 'right'; icon: IconName; label: string }[];

/**
 * Shows the tooltips without a visitor. The first button takes keyboard focus;
 * the others get the pointer-enter a mouse would send. There is no `open`
 * prop to set: a Tooltip opens only from the events a real user produces.
 */
function ShownTooltips() {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const buttons = wrap.current?.querySelectorAll<HTMLElement>('button') ?? [];
    buttons.forEach((button, index) => {
      if (index === 0) {
        button.focus();
      } else {
        button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      }
    });
  }, []);
  return (
    <div
      ref={wrap}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: tokens.space['3xl'],
        justifyItems: 'center',
        padding: `${tokens.space['3xl']}px ${tokens.space.xl}px`,
      }}
    >
      {PLACEMENTS.map(({ placement, icon, label }) => (
        <Tooltip key={placement} label={label} placement={placement}>
          <IconButton icon={icon} label={`${placement} example`} variant="soft" />
        </Tooltip>
      ))}
    </div>
  );
}

const Page = ({ mode }: { mode: ModeName }) => (
  <KitStage mode={mode}>
    <ShownTooltips />
  </KitStage>
);

/** One tooltip from keyboard focus, three from a mouse hover, one per placement. */
export const Shown = () => <Page mode="dark" />;

export const ShownLight = () => <Page mode="light" />;

/** A long label wraps instead of leaving the viewport. */
export const LongLabel = () => (
  <KitStage mode="dark">
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <LongShown />
    </div>
  </KitStage>
);

function LongShown() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);
  return (
    <div ref={ref} style={{ paddingTop: tokens.space['3xl'] }}>
      <Tooltip label="Mute your microphone for everyone in this voice room until you unmute it again" placement="bottom">
        <IconButton icon="MicOff" label="Mute" variant="soft" />
      </Tooltip>
    </div>
  );
}
