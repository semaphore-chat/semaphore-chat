import { ListRow, Stack, Text, TextField, type StackGap } from '../../kit';
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
