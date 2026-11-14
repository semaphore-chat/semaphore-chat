import { useEffect, useRef, useState } from 'react';
import { Checkbox } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { KitStage, Row } from '../fixtures/kitStory';

const LONG = 'Send me a weekly digest of everything that happened in all of the communities I belong to';

interface DemoProps {
  initial: boolean;
  label: string;
  description?: string;
  indeterminate?: boolean;
  disabled?: boolean;
  labelHidden?: boolean;
}

function Demo({ initial, ...rest }: DemoProps) {
  const [checked, setChecked] = useState(initial);
  return <Checkbox checked={checked} onChange={setChecked} {...rest} />;
}

function FocusedDemo() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const [checked, setChecked] = useState(true);
  return <Checkbox ref={ref} label="Focused" checked={checked} onChange={setChecked} />;
}

const Sheet = ({ mode, base, intensity }: { mode: ModeName; base?: string; intensity?: IntensityName }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <Row label="unchecked, checked, indeterminate">
      <Demo initial={false} label="Unchecked" />
      <Demo initial label="Checked" />
      <Demo initial={false} indeterminate label="Some" />
    </Row>
    <Row label="disabled">
      <Demo initial={false} label="Off" disabled />
      <Demo initial label="On" disabled />
    </Row>
  </KitStage>
);

/** Unchecked, checked, indeterminate, with a description, disabled each way, label hidden. */
export const States = () => (
  <KitStage mode="dark">
    <Row label="unchecked, checked, indeterminate">
      <Demo initial={false} label="Unchecked" />
      <Demo initial label="Checked" />
      <Demo initial={false} indeterminate label="Some" />
    </Row>
    <Row label="with description">
      <div style={{ width: 320 }}>
        <Demo initial label="Send reports" description="A summary every Monday" />
      </div>
    </Row>
    <Row label="disabled: unchecked, checked, indeterminate">
      <Demo initial={false} label="Off" disabled />
      <Demo initial label="On" disabled />
      <Demo initial={false} indeterminate label="Some" disabled />
    </Row>
    <Row label="label hidden">
      <Demo initial label="Select row" labelHidden />
    </Row>
  </KitStage>
);

/** Keyboard focus ring. */
export const Focused = () => (
  <KitStage mode="dark">
    <Row label="focused">
      <FocusedDemo />
    </Row>
  </KitStage>
);

/** A long label wraps inside a 320px box. */
export const LongLabel = () => (
  <KitStage mode="dark">
    <div style={{ width: 320 }}>
      <Demo initial label={LONG} description={LONG} />
    </div>
    <div style={{ width: 320 }}>
      <Demo initial={false} label="Averyveryverylongunbrokenlabelwithoutanyspacesatalljustlettersgoingon" />
    </div>
  </KitStage>
);

export const CheckboxLight = () => <Sheet mode="light" />;

export const CheckboxTinted = () => <Sheet mode="dark" base="#0d9488" intensity="vibrant" />;
