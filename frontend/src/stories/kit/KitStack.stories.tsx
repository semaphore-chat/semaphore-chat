import { Avatar, IconButton, ListRow, Pill, Stack, Text, TextField, type StackGap } from '../../kit';
import type { JSX } from 'react';
import { KitStage, Row } from '../fixtures/kitStory';
import { tokens } from '../../theme/generated/tokens';

const GAPS: StackGap[] = ['xs', 'sm', 'md', 'lg', 'xl'];

/** Each gap from the space tokens: a heading, a field and a row, one under the other. */
export const Gaps = () => (
  <KitStage mode="dark">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: tokens.space.xl }}>
      {GAPS.map((gap) => (
        <Row key={gap} label={`gap="${gap}"`}>
          <div style={{ width: tokens.layout.leftColumn }}>
            <Stack gap={gap}>
              <Text variant="section">Couch Co-op</Text>
              <TextField label="Find a community" labelHidden value="" onChange={() => undefined} placeholder="Find a community" shape="round" />
              <ListRow primary="general" secondary="3 unread" onClick={() => undefined} />
            </Stack>
          </div>
        </Row>
      ))}
    </div>
  </KitStage>
);

/** The same, light. */
export const GapsLight = () => (
  <KitStage mode="light">
    <div style={{ width: tokens.layout.leftColumn }}>
      <Stack gap="lg">
        <Text variant="section">Couch Co-op</Text>
        <TextField label="Find a community" labelHidden value="" onChange={() => undefined} placeholder="Find a community" shape="round" />
        <ListRow primary="general" onClick={() => undefined} />
      </Stack>
    </div>
  </KitStage>
);

/** The same, tinted. */
export const GapsTinted = () => (
  <KitStage mode="dark" base="#0d9488" intensity="vibrant">
    <div style={{ width: tokens.layout.leftColumn }}>
      <Stack gap="lg">
        <Text variant="section">Couch Co-op</Text>
        <TextField label="Find a community" labelHidden value="" onChange={() => undefined} placeholder="Find a community" shape="round" />
        <ListRow primary="general" onClick={() => undefined} />
      </Stack>
    </div>
  </KitStage>
);

function RowsBody(): JSX.Element {
  return (
    <div style={{ width: tokens.layout.leftColumn, maxWidth: '100%' }}>
      <Stack gap="lg">
        <Stack direction="row" gap="md">
          <Avatar decorative name="Couch Co-op" shape="rounded" size="lg" />
          <Stack gap="xs" fill>
            <Text variant="title" truncate>The Couch Co-op and Friends of the Couch</Text>
            <Text variant="meta" tone="secondary" truncate>9 around</Text>
          </Stack>
          <IconButton icon="ChevronDown" label="Couch Co-op, community menu" variant="soft" size="sm" />
        </Stack>
        <Stack gap="xs" align="start">
          <Text variant="name" truncate>A room name far too long for its column, cut with an ellipsis</Text>
          <Pill tone="accent" size="sm">You're here</Pill>
        </Stack>
      </Stack>
    </div>
  );
}

/**
 * `direction="row"`: side by side and centred; the avatar and the button keep their size, the `fill` Stack takes
 * the rest and its text cuts. `align="start"`: a Pill keeps its own width under a name.
 */
export const Rows = () => (
  <KitStage mode="dark">
    <RowsBody />
  </KitStage>
);

/** The same, light. */
export const RowsLight = () => (
  <KitStage mode="light">
    <RowsBody />
  </KitStage>
);
