/**
 * The kit's CallStack in a three-islands call slot: a surface far taller than its share of the frame (it
 * scrolls inside itself), the bar under it (always whole), the summary line that stands in for the surface
 * while the on-screen keyboard is up, and no surface at all.
 */
import { Button, CallStack, Card, IconButton, ListRow, Text } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { CallSlotFrame } from '../fixtures/CallSlotFrame';

const ROWS = Array.from({ length: 14 }, (_, i) => `Surface row ${i + 1}`);

const surface = (
  <Card padding="md">
    <Text variant="meta" tone="secondary">
      Taller than two fifths of the frame: it scrolls here.
    </Text>
    {ROWS.map((row) => (
      <ListRow key={row} primary={row} trailing={<Button size="sm">Watch</Button>} />
    ))}
  </Card>
);

const summary = (
  <Card padding="md">
    <ListRow primary="14 rows · the surface in one line" />
  </Card>
);

const bar = (
  <Card padding="md">
    <ListRow
      size="lg"
      strong
      primary="The bar"
      secondary="Never shrunk or clipped"
      trailing={<IconButton icon="PhoneOff" label="Leave call" variant="danger" />}
    />
  </Card>
);

function Stage({ mode = 'dark', keyboard = false, withSurface = true }: { mode?: ModeName; keyboard?: boolean; withSurface?: boolean }) {
  return (
    <CallSlotFrame mode={mode} keyboard={keyboard}>
      {() => <CallStack bar={bar} surface={withSurface ? surface : undefined} summary={summary} />}
    </CallSlotFrame>
  );
}

/** A tall surface: bounded to two fifths of the frame, scrolling; the bar whole under it. */
export const Bounded = () => <Stage />;
/** The same, light. */
export const BoundedLight = () => <Stage mode="light" />;
/** The on-screen keyboard is up (faked): the summary line stands in for the surface. */
export const Keyboard = () => <Stage keyboard />;
/** No surface: only the bar (no summary either). */
export const BarOnly = () => <Stage withSurface={false} />;
