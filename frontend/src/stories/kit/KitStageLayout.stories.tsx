import { useState, type JSX } from 'react';
import { AppFrame, Island, StageLayout, type StageLayoutProps } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from '../fixtures/kitStory';
import {
  SampleControls,
  SamplePeople,
  SampleScreen,
  SampleStageHeader,
  SampleStrip,
} from '../fixtures/layoutSamples';

/**
 * The call screen's layout: one island, a header row, the stage (contained and centred), a strip of tiles and the
 * controls. The people are a Sheet at every width.
 */
function Screen({ mode, startOpen = false, ...props }: { mode: ModeName; startOpen?: boolean } & Partial<StageLayoutProps>): JSX.Element {
  const [open, setOpen] = useState(startOpen);
  return (
    <KitFrameStage mode={mode}>
      <AppFrame>
        <StageLayout
          header={<SampleStageHeader />}
          stage={<SampleScreen />}
          strip={<SampleStrip />}
          controls={<SampleControls />}
          stageLabel="Squad Up"
          side={<SamplePeople />}
          sideLabel="People"
          sideOpen={open}
          onSideClose={() => setOpen(false)}
          {...props}
        />
      </AppFrame>
    </KitFrameStage>
  );
}

export const Sharing = () => <Screen mode="dark" />;

export const PeopleOpen = () => <Screen mode="dark" startOpen />;

export const SharingLight = () => <Screen mode="light" />;

/** No strip: the stage takes the room and no gap is left above the controls. */
export const NoStrip = () => <Screen mode="dark" strip={undefined} />;

/**
 * `inIsland`: inside a template's island (the Lounge's stage template puts the room in the three islands' centre),
 * with no island of its own. Here the island stands alone in the frame.
 */
export const InIsland = () => (
  <KitFrameStage mode="dark">
    <AppFrame>
      {/* Takes the frame's height, as a template's pane does. */}
      <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Island as="main" label="Squad Up" padding="none" scroll>
        <StageLayout
          inIsland
          header={<SampleStageHeader />}
          stage={<SampleScreen />}
          strip={<SampleStrip />}
          controls={<SampleControls />}
          stageLabel="Squad Up"
        />
      </Island>
      </div>
    </AppFrame>
  </KitFrameStage>
);
