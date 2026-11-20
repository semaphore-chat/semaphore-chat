import { Text, type TextTone, type TextVariant } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';

const VARIANTS: TextVariant[] = ['title', 'section', 'name', 'body', 'bodyStrong', 'meta', 'small', 'tag'];
const TONES: TextTone[] = ['default', 'secondary', 'dim', 'accent', 'danger'];

const Samples = () => (
  <>
    {VARIANTS.map((variant) => (
      <Row key={variant} label={variant}>
        <Text variant={variant}>The quick brown fox jumps over the lazy dog</Text>
      </Row>
    ))}
  </>
);

/** All eight type styles with a sample line each, in dark mode. */
export const Variants = () => (
  <KitStage mode="dark">
    <Samples />
  </KitStage>
);

/** Every tone on body text, in dark mode. */
export const Tones = () => (
  <KitStage mode="dark">
    {TONES.map((tone) => (
      <Row key={tone} label={tone}>
        <Text tone={tone}>The quick brown fox jumps over the lazy dog</Text>
      </Row>
    ))}
  </KitStage>
);

/** All eight type styles in light mode. */
export const VariantsLight = () => (
  <KitStage mode="light">
    <Samples />
  </KitStage>
);

/** Every tone in the tinted palette (teal, vibrant). */
export const TonesTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    {TONES.map((tone) => (
      <Row key={tone} label={tone}>
        <Text tone={tone}>The quick brown fox jumps over the lazy dog</Text>
      </Row>
    ))}
  </KitStage>
);

/** Truncation inside a narrow box: one line with an ellipsis. */
export const Truncated = () => (
  <KitStage mode="dark">
    <div style={{ width: 160 }}>
      <Text truncate>A long channel name that cannot fit in the box</Text>
    </div>
  </KitStage>
);
