import { useState, type JSX } from 'react';
import { AppFrame, StageLayout, type StageLayoutProps } from '../../kit';
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
