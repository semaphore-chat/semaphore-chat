/**
 * The page the community left island and members stories render on: the real ThreeIslands template
 * with the pieces' views in its slots.
 */
import type { JSX, ReactNode } from 'react';
import { AppFrame, ThreeIslands } from '../../kit';
import { AvatarCacheProvider } from '../../contexts/AvatarCacheContext';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitFrameStage } from './kitStory';
import { SampleDock } from './layoutSamples';
import { noop } from './loungeCommunity';

/**
 * The page: the template the frame uses, with the dock sample, `left` in the left island (the phone
 * shows it, a community home) and `right` in the members region.
 */
export function CommunityPage({
  mode = 'dark',
  left,
  right,
  phonePane = 'left',
  rightOpen,
}: {
  mode?: ModeName;
  left: ReactNode;
  right?: ReactNode;
  phonePane?: 'left' | 'centre';
  /** Leave it out: the members show at wide and stay closed below (the template's default). */
  rightOpen?: boolean;
}): JSX.Element {
  return (
    <KitFrameStage mode={mode}>
      <AvatarCacheProvider>
        <AppFrame>
          <ThreeIslands
            dock={<SampleDock />}
            left={left}
            leftLabel="Couch Co-op"
            centre={null}
            centreLabel="general"
            right={right}
            rightLabel="Members"
            rightOpen={rightOpen}
            onRightClose={noop}
            phonePane={phonePane}
          />
        </AppFrame>
      </AvatarCacheProvider>
    </KitFrameStage>
  );
}

