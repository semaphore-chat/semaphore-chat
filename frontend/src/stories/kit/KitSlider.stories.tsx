import { useEffect, useRef, useState } from 'react';
import { Slider, type SliderProps } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { KitStage, Row } from '../fixtures/kitStory';

const LONG = 'Microphone input sensitivity while push to talk is held down in a very busy room';

function Demo({ initial, ...rest }: { initial: number } & Partial<SliderProps>) {
  const [value, setValue] = useState(initial);
  return <Slider label="Volume" value={value} onChange={setValue} {...rest} />;
}

function FocusedDemo() {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    wrap.current?.querySelector('input')?.focus();
  }, []);
  return (
    <div ref={wrap}>
      <Demo initial={60} />
    </div>
  );
}

const Sheet = ({ mode, base, intensity }: { mode: ModeName; base?: string; intensity?: IntensityName }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <Demo initial={0} label="At minimum" />
    <Demo initial={60} />
    <Demo initial={100} label="At maximum" />
    <Demo initial={40} disabled label="Disabled" />
  </KitStage>
);

/** Minimum, middle, maximum, disabled and label hidden. */
export const States = () => (
  <KitStage mode="dark">
    <Demo initial={0} label="At minimum" />
    <Demo initial={60} />
    <Demo initial={100} label="At maximum" />
    <Demo initial={40} disabled label="Disabled" />
    <Row label="label hidden">
      <div style={{ width: 240 }}>
        <Demo initial={30} labelHidden />
      </div>
    </Row>
  </KitStage>
);

/** Keyboard focus ring on the thumb. */
export const Focused = () => (
  <KitStage mode="dark">
    <FocusedDemo />
  </KitStage>
);

/** A percent and a "12 dB" example. */
export const Formatted = () => (
  <KitStage mode="dark">
    <Demo initial={65} label="Opacity" formatValue={(v) => `${v}%`} />
    <Demo initial={12} label="Gain" min={-12} max={24} formatValue={(v) => `${v} dB`} />
  </KitStage>
);

/** A long label wraps and the value stays at the right, in a 320px box. */
export const LongLabel = () => (
  <KitStage mode="dark">
    <div style={{ width: 320 }}>
      <Demo initial={50} label={LONG} formatValue={(v) => `${v} percent`} />
    </div>
  </KitStage>
);

export const SliderLight = () => <Sheet mode="light" />;

export const SliderTinted = () => <Sheet mode="dark" base="#0d9488" intensity="vibrant" />;
