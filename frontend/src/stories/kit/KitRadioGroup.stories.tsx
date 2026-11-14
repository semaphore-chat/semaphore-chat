import { useEffect, useState } from 'react';
import { RadioGroup, type RadioOption } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { KitStage, Row } from '../fixtures/kitStory';

const LONG = 'Send me a weekly digest of everything that happened in all of the communities I belong to';

const OPTIONS: RadioOption[] = [
  { value: 'all', label: 'All messages' },
  { value: 'mentions', label: 'Mentions only' },
  { value: 'off', label: 'Nothing', disabled: true },
];
const DESCRIBED: RadioOption[] = [
  { value: 'all', label: 'All messages', description: 'Every message in every channel' },
  { value: 'mentions', label: 'Mentions only', description: 'Only when someone mentions you' },
];

function Demo({
  options,
  initial,
  focusFirst,
  ...rest
}: { options: RadioOption[]; initial: string; focusFirst?: boolean; orientation?: 'vertical' | 'horizontal'; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (focusFirst) {
      document.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.focus();
    }
  }, [focusFirst]);
  return <RadioGroup label="Notify me" options={options} value={value} onChange={setValue} {...rest} />;
}

const Sheet = ({ mode, base, intensity }: { mode: ModeName; base?: string; intensity?: IntensityName }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <Demo options={OPTIONS} initial="all" />
    <Demo options={DESCRIBED} initial="mentions" orientation="horizontal" />
  </KitStage>
);

/** Vertical, horizontal, with descriptions, a disabled option and a disabled group. */
export const States = () => (
  <KitStage mode="dark">
    <Row label="vertical, one option disabled">
      <Demo options={OPTIONS} initial="all" />
    </Row>
    <Row label="horizontal">
      <Demo options={OPTIONS.slice(0, 2)} initial="mentions" orientation="horizontal" />
    </Row>
    <Row label="with descriptions">
      <div style={{ width: 320 }}>
        <Demo options={DESCRIBED} initial="all" />
      </div>
    </Row>
    <Row label="group disabled">
      <Demo options={OPTIONS} initial="mentions" disabled />
    </Row>
  </KitStage>
);

/** Keyboard focus ring on the selected radio. */
export const Focused = () => (
  <KitStage mode="dark">
    <Row label="focused">
      <Demo options={OPTIONS} initial="mentions" focusFirst />
    </Row>
  </KitStage>
);

/** Long labels wrap inside a 320px box. */
export const LongLabel = () => (
  <KitStage mode="dark">
    <div style={{ width: 320 }}>
      <Demo
        initial="a"
        options={[
          { value: 'a', label: LONG, description: LONG },
          { value: 'b', label: 'Averyveryverylongunbrokenlabelwithoutanyspacesatalljustlettersgoingon' },
        ]}
      />
    </div>
    <div style={{ width: 320 }}>
      <Demo
        initial="a"
        orientation="horizontal"
        options={[
          { value: 'a', label: LONG },
          { value: 'b', label: 'Short' },
        ]}
      />
    </div>
  </KitStage>
);

export const RadioGroupLight = () => <Sheet mode="light" />;

export const RadioGroupTinted = () => <Sheet mode="dark" base="#0d9488" intensity="vibrant" />;
