import { AppFrame, Island, Text } from '../../kit';
import { KitFrameStage } from '../fixtures/kitStory';

/**
 * The frame alone: the ground, the gutter and the safe-area insets, exactly the viewport's height. The
 * one island scrolls inside itself; the page never does.
 */
export const Empty = () => (
  <KitFrameStage mode="dark">
    <AppFrame>
      <Island as="main" label="Empty frame" scroll>
        <Text variant="title" as="h1">An empty frame</Text>
        <Text tone="secondary">The island fills the frame. Its content scrolls inside it, never the page.</Text>
        {Array.from({ length: 40 }, (_, row) => (
          <p key={row}>
            <Text>Row {row + 1}, to show the island scrolling and the page staying still.</Text>
          </p>
        ))}
      </Island>
    </AppFrame>
  </KitFrameStage>
);
