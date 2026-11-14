import { useEffect, useRef, type RefObject } from 'react';
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

/** A label longer than 60 characters inside a 240px box: one line, ellipsis, never wider than the box. */
export const LongLabel = () => (
  <KitStage mode="dark">
    <div style={{ width: 240 }}>
      <Button variant="primary">
        A very long label that goes on and on and on, well past sixty characters
      </Button>
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

/** Focuses the element it is attached to on mount: only one element can hold focus per story. */
function useFocusedRef<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/** Keyboard focus ring on the primary button. */
export const Focused = () => {
  const ref = useFocusedRef<HTMLButtonElement>();
  return (
    <KitStage mode="dark">
      <Row label="primary, focused">
        <Button ref={ref} variant="primary">
          Join room
        </Button>
      </Row>
      <VariantGrid />
    </KitStage>
  );
};

/** Keyboard focus ring on a ghost button, where the ring has no fill to sit against. */
export const FocusedGhost = () => {
  const ref = useFocusedRef<HTMLButtonElement>();
  return (
    <KitStage mode="dark">
      <Row label="ghost, focused">
        <Button ref={ref} variant="ghost">
          Cancel
        </Button>
      </Row>
    </KitStage>
  );
};

/** Keyboard focus ring on a danger button, against the strongest fill. */
export const FocusedDanger = () => {
  const ref = useFocusedRef<HTMLButtonElement>();
  return (
    <KitStage mode="dark">
      <Row label="danger, focused">
        <Button ref={ref} variant="danger">
          Delete room
        </Button>
      </Row>
    </KitStage>
  );
};
