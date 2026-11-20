import { Pill, type PillSize, type PillTone } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const TONES: PillTone[] = ['neutral', 'accent', 'danger', 'positive', 'warning'];
const SIZES: PillSize[] = ['md', 'sm'];

const Grid = () => (
  <>
    {SIZES.map((size) => (
      <div key={size} style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.lg }}>
        <Row label={`${size}: plain`}>
          {TONES.map((tone) => (
            <Pill key={tone} tone={tone} size={size}>
              {tone}
            </Pill>
          ))}
        </Row>
        <Row label={`${size}: with dot`}>
          {TONES.map((tone) => (
            <Pill key={tone} tone={tone} size={size} dot>
              {tone}
            </Pill>
          ))}
        </Row>
        <Row label={`${size}: with icon`}>
          {TONES.map((tone) => (
            <Pill key={tone} tone={tone} size={size} icon="Bell">
              {tone}
            </Pill>
          ))}
        </Row>
      </div>
    ))}
    <Row label="Long text stays on one line">
      <Pill dot tone="warning">
        Reconnecting to the voice server…
      </Pill>
    </Row>
  </>
);

/** Five tones, each plain, with a dot and with an icon, at two sizes. */
export const Tones = () => (
  <KitStage mode="dark">
    <Grid />
  </KitStage>
);

/** The same in light mode. */
export const TonesLight = () => (
  <KitStage mode="light">
    <Grid />
  </KitStage>
);

/** The same in the tinted palette. */
export const TonesTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Grid />
  </KitStage>
);
