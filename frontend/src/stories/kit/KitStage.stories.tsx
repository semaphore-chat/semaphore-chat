import { KitStage, Row } from '../fixtures/kitStory';

/** The kit stage in dark mode: the Lounge ground, with a row that wraps at phone width. */
export const Stage = () => (
  <KitStage mode="dark">
    <Row label="Row of plain text">
      <span>First span of plain text that is long enough to need room</span>
      <span>Second span of plain text that is long enough to wrap below</span>
    </Row>
  </KitStage>
);

/** The kit stage pinned to light mode, because the review shoots only the default state. */
export const StageLight = () => (
  <KitStage mode="light">
    <Row label="Row of plain text">
      <span>First span of plain text that is long enough to need room</span>
      <span>Second span of plain text that is long enough to wrap below</span>
    </Row>
  </KitStage>
);
