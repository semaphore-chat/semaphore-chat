import type { JSX } from 'react';
import { IconButton, Island, ListRow, PanelPane, Stack, Text, TextField } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';

/**
 * A filling right panel that is not a conversation (the chat's search): the heading and Close, a fixed field, then a
 * body that scrolls on its own. In a right island with no padding (ThreeIslands `rightFill`), 640 px high, with more
 * rows than fit, so the heading and the field stay while the list scrolls.
 */
function PaneBody({ rows }: { rows: number }): JSX.Element {
  return (
    <div style={{ width: tokens.layout.rightColumn, maxWidth: '100%', height: 640, display: 'flex', flexDirection: 'column' }}>
      <Island as="aside" label="Search messages" padding="none" scroll>
        <PanelPane
          header={
            <Stack direction="row" gap="sm">
              <Stack direction="row" gap="xs" fill>
                <Text variant="title" as="h2" truncate>
                  Search messages
                </Text>
              </Stack>
              <IconButton icon="X" label="Close search" variant="ghost" onClick={() => undefined} />
            </Stack>
          }
          top={<TextField label="Search messages" labelHidden type="search" shape="round" startIcon="Search" value="run" onChange={() => undefined} />}
        >
          {Array.from({ length: rows }, (_, i) => (
            <ListRow key={i} size="lg" primary={`aiko · ${20 - i} min ago`} secondary="the run tomorrow is at 9, bring snacks" onClick={() => undefined} />
          ))}
        </PanelPane>
      </Island>
    </div>
  );
}

export const Scrolling = () => (
  <KitStage mode="dark">
    <PaneBody rows={20} />
  </KitStage>
);

export const ScrollingLight = () => (
  <KitStage mode="light">
    <PaneBody rows={20} />
  </KitStage>
);

export const Short = () => (
  <KitStage mode="dark">
    <PaneBody rows={2} />
  </KitStage>
);
