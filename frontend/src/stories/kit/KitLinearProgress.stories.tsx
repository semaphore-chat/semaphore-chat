import { LinearProgress, type LinearProgressTone } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const TONES: LinearProgressTone[] = ['accent', 'positive', 'danger'];
const VALUES = [0, 40, 100];

const Grid = () => (
  <>
    {TONES.map((tone) => (
      <div key={tone} style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md }}>
        <Row label={tone}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md, width: '100%' }}>
            {VALUES.map((value) => (
              <LinearProgress key={value} label={`${tone} ${value}`} value={value} tone={tone} />
            ))}
            <LinearProgress label={`${tone} indeterminate`} tone={tone} />
          </div>
        </Row>
      </div>
    ))}
  </>
);

/** 0, 40, 100 and indeterminate, in all three tones. */
export const Values = () => (
  <KitStage mode="dark">
    <Grid />
  </KitStage>
);

export const ValuesLight = () => (
  <KitStage mode="light">
    <Grid />
  </KitStage>
);

export const ValuesTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Grid />
  </KitStage>
);
