import { useEffect, useRef, useState } from 'react';
import { Switch } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitStage, Row } from '../fixtures/kitStory';

const LONG = 'Send me a weekly digest of everything that happened in all of the communities I belong to';

function Demo({ initial, ...rest }: { initial: boolean; label: string; description?: string; disabled?: boolean; labelHidden?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} {...rest} />;
}

function FocusedDemo() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const [checked, setChecked] = useState(true);
  return <Switch ref={ref} label="Focused" checked={checked} onChange={setChecked} />;
}

const Sheet = ({ mode, base, intensity }: { mode: ModeName; base?: string; intensity?: 'minimal' | 'vibrant' }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <Row label="off, on">
      <Demo initial={false} label="Notifications" />
      <Demo initial label="Notifications" />
    </Row>
    <Row label="with description">
      <div style={{ width: 320 }}>
        <Demo initial label="Mentions" description="Ping me when someone mentions me" />
      </div>
    </Row>
    <Row label="disabled, off and on">
      <Demo initial={false} label="Off" disabled />
      <Demo initial label="On" disabled />
    </Row>
  </KitStage>
);

/** Off, on, with a description, disabled each way, and the label hidden. */
export const States = () => (
  <KitStage mode="dark">
    <Row label="off, on">
      <Demo initial={false} label="Notifications" />
      <Demo initial label="Notifications" />
    </Row>
    <Row label="with description">
      <div style={{ width: 320 }}>
        <Demo initial label="Mentions" description="Ping me when someone mentions me" />
      </div>
    </Row>
    <Row label="disabled, off and on">
      <Demo initial={false} label="Off" disabled />
      <Demo initial label="On" disabled />
    </Row>
    <Row label="label hidden">
      <Demo initial label="Mute" labelHidden />
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

export const SwitchLight = () => <Sheet mode="light" />;

export const SwitchTinted = () => <Sheet mode="dark" base="#0d9488" intensity="vibrant" />;
