import { useEffect, useRef, type ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';

const VARIANTS: ButtonVariant[] = ['primary', 'soft', 'ghost', 'danger', 'quietDanger', 'text'];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const VariantGrid = () => (
  <>
    {VARIANTS.map((variant) => (
      <Row key={variant} label={variant}>
        {SIZES.map((size) => (
          <Button key={size} variant={variant} size={size}>
            Join room
          </Button>
        ))}
      </Row>
    ))}
  </>
);

/** Six variants in three sizes, dark mode. */
export const Variants = () => (
  <KitStage mode="dark">
    <VariantGrid />
  </KitStage>
);

/** Per variant: default, disabled, loading, with a start icon, loading with a start icon. */
export const States = () => (
  <KitStage mode="dark">
    {VARIANTS.map((variant) => (
      <Row key={variant} label={variant}>
        <Button variant={variant}>Join room</Button>
        <Button variant={variant} disabled>
          Join room
        </Button>
        <Button variant={variant} loading>
          Join room
        </Button>
        <Button variant={variant} startIcon={<PlusIcon />}>
          Join room
        </Button>
        <Button variant={variant} startIcon={<PlusIcon />} loading>
          Join room
        </Button>
      </Row>
    ))}
  </KitStage>
);

/** A 60-character label inside a 240px box, and a fullWidth button: one line, ellipsis, never wider than the box. */
export const LongLabel = () => (
  <KitStage mode="dark">
    <div style={{ width: 240 }}>
      <Button variant="primary">A very long label that goes on and on and on for sixty</Button>
    </div>
    <div style={{ width: 240 }}>
      <Button variant="soft" fullWidth>
        Full width
      </Button>
    </div>
    <div style={{ width: 240 }}>
      <Button variant="primary" fullWidth startIcon={<PlusIcon />}>
        Full width with a long label that overflows the box
      </Button>
    </div>
  </KitStage>
);

/** The same grid in light mode. */
export const VariantsLight = () => (
  <KitStage mode="light">
    <VariantGrid />
  </KitStage>
);

/** The grid and states in the tinted palette (teal, vibrant). */
export const VariantsTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <VariantGrid />
    <Row label="states">
      <Button variant="primary" disabled>
        Disabled
      </Button>
      <Button variant="primary" loading>
        Loading
      </Button>
      <Button variant="soft" startIcon={<PlusIcon />}>
        With icon
      </Button>
    </Row>
  </KitStage>
);

function FocusFirst({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** Keyboard focus ring on the primary button (only one element can hold focus per story). */
export const Focused = () => (
  <KitStage mode="dark">
    <FocusFirst>
      <Row label="primary, focused">
        <Button variant="primary">Join room</Button>
      </Row>
    </FocusFirst>
    <VariantGrid />
  </KitStage>
);

/** Keyboard focus ring on a ghost button, where the ring has no fill to sit against. */
export const FocusedGhost = () => (
  <KitStage mode="dark">
    <FocusFirst>
      <Row label="ghost, focused">
        <Button variant="ghost">Cancel</Button>
      </Row>
    </FocusFirst>
  </KitStage>
);
