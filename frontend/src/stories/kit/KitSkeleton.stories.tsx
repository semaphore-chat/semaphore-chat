import { Skeleton } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage, Row } from '../fixtures/kitStory';

const ShapesGrid = () => (
  <>
    <Row label="A list row: circle and two text lines">
      <div style={{ display: 'flex', gap: tokens.space.md, alignItems: 'center', width: '100%' }}>
        <Skeleton shape="circle" size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Skeleton shape="text" lines={2} />
        </div>
      </div>
    </Row>
    <Row label="Circle sizes">
      <Skeleton shape="circle" size="xs" />
      <Skeleton shape="circle" size="md" />
      <Skeleton shape="circle" size="xl" />
    </Row>
    <Row label="Rect">
      <div style={{ width: '100%' }}>
        <Skeleton shape="rect" />
      </div>
    </Row>
    <Row label="Text, three lines">
      <div style={{ width: '100%' }}>
        <Skeleton shape="text" lines={3} />
      </div>
    </Row>
  </>
);

/** The three shapes, and a list-row composition. */
export const Shapes = () => (
  <KitStage mode="dark">
    <ShapesGrid />
  </KitStage>
);

export const ShapesLight = () => (
  <KitStage mode="light">
    <ShapesGrid />
  </KitStage>
);
