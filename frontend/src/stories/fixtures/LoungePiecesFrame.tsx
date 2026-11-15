/**
 * The chat template (ThreeIslands in an AppFrame) with sample left and centre islands, for the new
 * shell's piece stories: a piece is shown where the frame puts it (the dock above the left island, or
 * the bottom bar on a phone; a sheet over all of it).
 */
import type { JSX, ReactNode } from 'react';
import { AppFrame, ThreeIslands, useWidthRange, type WidthRange } from '../../kit';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from './kitStory';
import { SampleChannels, SampleConversation } from './layoutSamples';

function Template({ dock, children }: { dock: (range: WidthRange) => ReactNode; children?: ReactNode }): JSX.Element {
  const range = useWidthRange();
  return (
    <AppFrame>
      <ThreeIslands
        dock={dock(range)}
        left={<SampleChannels />}
        leftLabel="Couch Co-op"
        centre={<SampleConversation />}
        centreLabel="general in Couch Co-op"
        phonePane="left"
      />
      {children}
    </AppFrame>
  );
}

export function LoungePiecesFrame({
  mode = 'dark',
  dock,
  children,
}: {
  mode?: ModeName;
  /** The dock slot, given the width range (a phone's dock is the bottom bar). */
  dock: (range: WidthRange) => ReactNode;
  /** Overlays (a sheet) over the frame. */
  children?: ReactNode;
}): JSX.Element {
  return (
    <KitFrameStage mode={mode}>
      <Template dock={dock}>{children}</Template>
    </KitFrameStage>
  );
}
