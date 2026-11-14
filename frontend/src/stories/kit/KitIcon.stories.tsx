import { Icon, Text, iconNames, type IconSize, type IconTone } from '../../kit';
import { KitStage, Row } from '../fixtures/kitStory';
import { tokens } from '../../theme/generated/tokens';

const SIZES: IconSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const TONES: IconTone[] = [
  'inherit',
  'default',
  'secondary',
  'dim',
  'accent',
  'danger',
  'positive',
  'warning',
];

const AllIcons = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${tokens.space.lg}px` }}>
    {iconNames.map((name) => (
      <div
        key={name}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: `${tokens.space.xs}px`,
          width: `${tokens.space['3xl'] * 2}px`,
        }}
      >
        <Icon name={name} size="lg" />
        <Text variant="small" tone="secondary">
          {name}
        </Text>
      </div>
    ))}
  </div>
);

const ToneGrid = () => (
  <>
    {TONES.map((tone) => (
      <Row key={tone} label={tone}>
        <Icon name="Bell" tone={tone} size="lg" />
        <Icon name="Bell" tone={tone} size="xl" />
        <Text variant="small" tone="secondary">
          Notifications
        </Text>
      </Row>
    ))}
  </>
);

/** Every generated icon at lg, with its name under it. */
export const All = () => (
  <KitStage mode="dark">
    <AllIcons />
  </KitStage>
);

/** One icon at each of the five token sizes. */
export const Sizes = () => (
  <KitStage mode="dark">
    <Row label="xs sm md lg xl">
      {SIZES.map((size) => (
        <Icon key={size} name="Mic" size={size} />
      ))}
    </Row>
  </KitStage>
);

/** Each tone against its label; `inherit` paints the text it sits in. */
export const Tones = () => (
  <KitStage mode="dark">
    <ToneGrid />
  </KitStage>
);

/** Every icon at lg in light mode. */
export const AllLight = () => (
  <KitStage mode="light">
    <AllIcons />
  </KitStage>
);
