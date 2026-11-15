import { Alert, AppFrame, Island, ThreeIslands, Text } from '../../kit';
import { KitFrameStage } from '../fixtures/kitStory';
import { SampleChannels, SampleConversation } from '../fixtures/layoutSamples';

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

/**
 * The banner row: a notice about the whole app, above the layout and inside the safe area. It takes its natural
 * height and the layout fills the rest, so no island is pushed off screen.
 */
export const WithBanner = () => (
  <KitFrameStage mode="dark">
    <AppFrame
      banner={
        <Alert severity="warning" title="Reconnecting">
          You are offline. Messages you send will wait until the connection is back.
        </Alert>
      }
    >
      <ThreeIslands
        left={<SampleChannels />}
        leftLabel="Channels"
        centre={<SampleConversation />}
        centreLabel="general in Couch Co-op"
      />
    </AppFrame>
  </KitFrameStage>
);
