import { Badge, IconButton } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const COUNTS = [1, 9, 42, 99, 100];

const Grid = () => (
  <>
    {(['accent', 'danger'] as const).map((tone) => (
      <Row key={tone} label={tone}>
        {COUNTS.map((count) => (
          <Badge key={count} count={count} tone={tone} label={`${count} unread`} />
        ))}
        <Badge dot tone={tone} label="New activity" />
      </Row>
    ))}
    <Row label="On an icon button (wrapper positions the badge)">
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <IconButton icon="Bell" label="Notifications" variant="soft" />
        <span style={{ position: 'absolute', top: -tokens.space.xs, right: -tokens.space.xs }}>
          <Badge count={7} tone="accent" label="7 unread" />
        </span>
      </span>
    </Row>
  </>
);

/** Counts 1, 9, 42, 99, 100 (shows 99+) and a dot, in both tones. */
export const Counts = () => (
  <KitStage mode="dark">
    <Grid />
  </KitStage>
);

/** The same in light mode. */
export const CountsLight = () => (
  <KitStage mode="light">
    <Grid />
  </KitStage>
);

/** The same in the tinted palette. */
export const CountsTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <Grid />
  </KitStage>
);
