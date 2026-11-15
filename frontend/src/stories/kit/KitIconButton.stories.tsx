import { useEffect, useRef, useState } from 'react';
import { IconButton, Text, type IconButtonSize, type IconButtonVariant } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';

const VARIANTS: IconButtonVariant[] = ['ghost', 'soft', 'primary', 'danger'];
const SIZES: IconButtonSize[] = ['sm', 'md', 'lg'];

const Grid = () => (
  <>
    {VARIANTS.map((variant) => (
      <Row key={variant} label={variant}>
        {SIZES.map((size) => (
          <IconButton key={size} icon="Settings" label="Settings" variant={variant} size={size} />
        ))}
      </Row>
    ))}
  </>
);

/** Four variants in three sizes, dark mode. */
export const Variants = () => (
  <KitStage mode="dark">
    <Grid />
  </KitStage>
);

/** Default, selected, disabled and loading, per variant. */
export const States = () => (
  <KitStage mode="dark">
    {VARIANTS.map((variant) => (
      <Row key={variant} label={variant}>
        <IconButton icon="Mic" label="Mute" variant={variant} />
        <IconButton icon="Mic" label="Mute" variant={variant} selected />
        <IconButton icon="Mic" label="Mute" variant={variant} disabled />
        <IconButton icon="Mic" label="Mute" variant={variant} loading />
      </Row>
    ))}
  </KitStage>
);

/** Keyboard focus ring. */
export const Focused = () => {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <KitStage mode="dark">
      <Row label="soft, focused">
        <IconButton ref={ref} icon="Settings" label="Settings" variant="soft" />
      </Row>
      <Grid />
    </KitStage>
  );
};

/** The grid in light mode. */
export const VariantsLight = () => (
  <KitStage mode="light">
    <Grid />
    <Row label="selected">
      <IconButton icon="Mic" label="Mute" selected />
    </Row>
  </KitStage>
);

/** The grid in the tinted palette (teal, vibrant). */
export const VariantsTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Grid />
    <Row label="selected">
      <IconButton icon="Mic" label="Mute" selected />
    </Row>
  </KitStage>
);

/** `badge` (a count over the corner, worded by `badgeMeaning`) and `current` (the Dock's ring), on each variant. */
export const BadgeAndCurrent = () => (
  <KitStage mode="dark">
    {VARIANTS.map((variant) => (
      <Row key={variant} label={variant}>
        <IconButton icon="Inbox" label="Inbox" variant={variant} badge={9} />
        <IconButton icon="Inbox" label="Inbox" variant={variant} badge={128} />
        <IconButton icon="Inbox" label="Inbox" variant={variant} current />
        <IconButton icon="Inbox" label="Inbox" variant={variant} current badge={3} />
        <IconButton icon="AtSign" label="Mentions" variant={variant} badge={1} badgeMeaning="mentions" />
      </Row>
    ))}
  </KitStage>
);

/** The same, light. */
export const BadgeAndCurrentLight = () => (
  <KitStage mode="light">
    <Row label="primary">
      <IconButton icon="Inbox" label="Inbox" variant="primary" badge={9} />
      <IconButton icon="Inbox" label="Inbox" variant="primary" current badge={3} />
      <IconButton icon="LayoutGrid" label="All communities" variant="soft" current />
    </Row>
  </KitStage>
);

/** A current button with keyboard focus: the focus ring sits outside the current ring, on the surface. */
function CurrentFocusedStage({ mode, base, intensity }: { mode: 'dark' | 'light'; base?: string; intensity?: 'minimal' | 'balanced' | 'vibrant' }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <KitStage mode={mode} base={base} intensity={intensity}>
      <Row label="current + badge, focused; then current, not focused">
        <IconButton ref={ref} icon="Inbox" label="Inbox" variant="primary" current badge={9} />
        <IconButton icon="Inbox" label="Inbox" variant="primary" current badge={9} />
        <IconButton icon="LayoutGrid" label="All communities" variant="soft" current />
      </Row>
    </KitStage>
  );
}

export const CurrentFocused = () => <CurrentFocusedStage mode="dark" />;
export const CurrentFocusedLight = () => <CurrentFocusedStage mode="light" />;
export const CurrentFocusedTinted = () => <CurrentFocusedStage mode="dark" base="#0d9488" intensity="vibrant" />;

/** Badge and current on a tinted palette. */
export const BadgeAndCurrentTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Row label="primary, soft">
      <IconButton icon="Inbox" label="Inbox" variant="primary" badge={9} />
      <IconButton icon="Inbox" label="Inbox" variant="primary" current badge={3} />
      <IconButton icon="LayoutGrid" label="All communities" variant="soft" current />
    </Row>
  </KitStage>
);

/** The live hold: the button fills while held, and the counts show each start and end exactly once. */
function HoldDemo() {
  const [held, setHeld] = useState(false);
  const [counts, setCounts] = useState({ starts: 0, ends: 0 });
  return (
    <>
      <Row label="hold to talk">
        <IconButton
          icon="Mic"
          label="Hold to talk"
          size="lg"
          variant={held ? 'primary' : 'soft'}
          hold={{
            onStart: () => {
              setHeld(true);
              setCounts((c) => ({ ...c, starts: c.starts + 1 }));
            },
            onEnd: () => {
              setHeld(false);
              setCounts((c) => ({ ...c, ends: c.ends + 1 }));
            },
          }}
        />
        <Text variant="meta" tone="secondary">
          <span data-testid="hold-state">{held ? 'Holding' : 'Not holding'}</span>
          {` · starts ${counts.starts} · ends ${counts.ends}`}
        </Text>
      </Row>
      <Row label="disabled">
        <IconButton icon="MicOff" label="Hold to talk" size="lg" variant="soft" disabled hold={{ onStart: () => {}, onEnd: () => {} }} />
      </Row>
    </>
  );
}

/** `hold`: a press-and-hold control (hold to talk). Sliding off keeps the hold; lifting ends it. */
export const Hold = () => (
  <KitStage mode="dark">
    <HoldDemo />
  </KitStage>
);

/** `hold` in light mode. */
export const HoldLight = () => (
  <KitStage mode="light">
    <HoldDemo />
  </KitStage>
);
