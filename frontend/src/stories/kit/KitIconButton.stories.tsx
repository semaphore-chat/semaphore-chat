import { useEffect, useRef } from 'react';
import { IconButton, type IconButtonSize, type IconButtonVariant } from '../../kit';
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
