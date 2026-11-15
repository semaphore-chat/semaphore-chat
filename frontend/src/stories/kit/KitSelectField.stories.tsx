import { useEffect, useRef, useState } from 'react';
import { SelectField, type SelectFieldProps, type SelectOption } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { KitStage } from '../fixtures/kitStory';

const OPTIONS: SelectOption[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends only' },
  { value: 'members', label: 'Community members' },
  { value: 'nobody', label: 'Nobody', disabled: true },
];

const LONG_OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Send me a weekly digest of everything that happened in all of the communities I belong to' },
  { value: 'b', label: 'Averyveryverylongunbrokenlabelwithoutanyspacesatalljustlettersgoingonandon' },
  { value: 'c', label: 'Short' },
];

type DemoProps = { initial?: string } & Partial<Omit<SelectFieldProps, 'value' | 'onChange'>>;

function Demo({ initial = '', label = 'Who can message you', options = OPTIONS, ...rest }: DemoProps) {
  const [value, setValue] = useState(initial);
  return <SelectField label={label} options={options} value={value} onChange={setValue} {...rest} />;
}

/**
 * Opens the menu on first render. SelectField has no `open` prop (its contract
 * is closed), so the story presses the combobox the way a pointer would.
 */
function OpenDemo(props: DemoProps) {
  const wrap = useRef<HTMLDivElement>(null);
  // MUI's Select learns its anchor element through a state update after the first
  // commit, so the press waits one render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!mounted) {
      return;
    }
    const box = wrap.current?.querySelector('[role="combobox"]');
    box?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
  }, [mounted]);
  return (
    <div ref={wrap}>
      <Demo {...props} />
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: 16,
      width: '100%',
    }}
  >
    {children}
  </div>
);

/** Placeholder, selected, helper, error and disabled. */
export const States = () => (
  <KitStage mode="dark">
    <Grid>
      <Demo label="Placeholder" placeholder="Choose who" />
      <Demo label="Selected" initial="friends" />
      <Demo label="Helper" initial="everyone" helper="Applies to new conversations" />
      <Demo label="Error" placeholder="Choose who" error="Pick one to continue" />
      <Demo label="Disabled" initial="everyone" disabled />
    </Grid>
  </KitStage>
);

/** The menu open with one option selected and one disabled. */
export const Open = () => (
  <KitStage mode="dark">
    <OpenDemo initial="friends" />
  </KitStage>
);

export const OpenLight = () => (
  <KitStage mode="light">
    <OpenDemo initial="friends" />
  </KitStage>
);

/** Long option text truncates in the field and in the open menu. */
export const LongOptions = () => (
  <KitStage mode="dark">
    <div style={{ width: 280 }}>
      <OpenDemo label="Digest" initial="a" options={LONG_OPTIONS} />
    </div>
  </KitStage>
);

const Closed = ({ mode, base, intensity }: { mode: ModeName; base?: string; intensity?: IntensityName }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <Demo placeholder="Choose who" />
    <Demo initial="friends" />
  </KitStage>
);

export const SelectFieldLight = () => <Closed mode="light" />;

export const SelectFieldTinted = () => <Closed mode="dark" base="#0d9488" intensity="vibrant" />;
