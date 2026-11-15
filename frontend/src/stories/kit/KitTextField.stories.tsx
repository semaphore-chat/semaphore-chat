import { useEffect, useRef, useState } from 'react';
import { TextField, type TextFieldProps } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { KitStage, Row } from '../fixtures/kitStory';

type DemoProps = { initial?: string } & Partial<Omit<TextFieldProps, 'value' | 'onChange'>>;

function Demo({ initial = '', label = 'Display name', ...rest }: DemoProps) {
  const [value, setValue] = useState(initial);
  return <TextField label={label} value={value} onChange={setValue} {...rest} />;
}

function FocusedDemo() {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <Demo ref={ref} initial="alex" label="Focused" />;
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

const Sheet = ({ mode, base, intensity }: { mode: ModeName; base?: string; intensity?: IntensityName }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <Grid>
      <Demo label="Empty" placeholder="Your name" />
      <Demo label="Filled" initial="alexk" />
      <Demo label="Helper" initial="alexk" helper="Shown to everyone" />
      <Demo label="Error" initial="alex k" error="No spaces allowed" />
      <Demo label="Required" required placeholder="Required" />
      <Demo label="Disabled" initial="moss.social" disabled />
    </Grid>
    <Demo label="Search" shape="round" startIcon="Search" placeholder="Search" />
  </KitStage>
);

/** Empty, filled, placeholder, helper, error, required, disabled and focused. */
export const States = () => (
  <KitStage mode="dark">
    <Grid>
      <Demo label="Empty" />
      <Demo label="Placeholder" placeholder="Your name" />
      <Demo label="Filled" initial="alexk" />
      <Demo label="Helper" initial="alexk" helper="Shown to everyone" />
      <Demo label="Error" initial="alex k" error="No spaces allowed" helper="Letters only" />
      <Demo label="Required" required placeholder="Required" />
      <Demo label="Disabled" initial="moss.social" disabled />
      <FocusedDemo />
    </Grid>
    <Row label="label hidden">
      <div style={{ width: 240 }}>
        <Demo label="Hidden label" labelHidden placeholder="Name this" />
      </div>
    </Row>
  </KitStage>
);

/** The field shape and the round search shape with a start icon. */
export const Shapes = () => (
  <KitStage mode="dark">
    <Demo label="Field" initial="alexk" />
    <Demo label="Round" shape="round" startIcon="Search" placeholder="Search" />
    <Demo label="Round, filled" shape="round" startIcon="Search" initial="moss" />
    <Demo label="Password" type="password" initial="hunter22" />
  </KitStage>
);

/** A textarea, fixed rows and growing. */
export const Multiline = () => (
  <KitStage mode="dark">
    <Demo label="About you" multiline rows={4} placeholder="Say something" helper="Up to 200 characters" />
    <Demo label="Grows" multiline initial={'One line\nTwo lines\nThree lines\nFour lines'} />
  </KitStage>
);

/** Everything inside a 280px box, with long text. */
export const Narrow = () => (
  <KitStage mode="dark">
    <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Demo
        label="A rather long label that has to wrap inside a narrow column of the page"
        initial="averyveryverylongunbrokenvaluewithoutanyspacesatalljustlettersgoingon"
        helper="A helper line that is long enough that it must wrap onto a second line"
      />
      <Demo label="Error" initial="x" error="An error message long enough that it wraps onto a second line too" />
      <Demo label="Search" shape="round" startIcon="Search" placeholder="Search everything in the community" />
    </div>
  </KitStage>
);

export const StatesLight = () => <Sheet mode="light" />;

export const StatesTinted = () => <Sheet mode="dark" base="#0d9488" intensity="vibrant" />;
