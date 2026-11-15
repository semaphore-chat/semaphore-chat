import { Spinner } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const SIZES = Object.keys(tokens.icon) as (keyof typeof tokens.icon)[];

/** Every size, decorative and labelled (the label is only for assistive technology). */
export const Sizes = () => (
  <KitStage mode="dark">
    <Row label="Decorative">
      {SIZES.map((size) => (
        <Spinner key={size} size={size} />
      ))}
    </Row>
    <Row label="With a label (role status)">
      {SIZES.map((size) => (
        <Spinner key={size} size={size} label={`Loading ${size}`} />
      ))}
    </Row>
  </KitStage>
);
