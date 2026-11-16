import type { JSX, ReactNode } from 'react';
import { Island } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';
import type { PALETTES } from './kitChatData';

/** A centre island the width of a chat column, capped to the viewport (so 390 px phones show it as they would). */
export function ChatColumn({ children, width = 640 }: { children: ReactNode; width?: number }): JSX.Element {
  return (
    <div style={{ width, maxWidth: '100%' }}>
      <Island as="div" padding="none">
        <div style={{ paddingBlock: tokens.space.lg }}>{children}</div>
      </Island>
    </div>
  );
}

/** A story body rendered on one palette. */
export function OnPalette({
  palette,
  children,
}: {
  palette: (typeof PALETTES)[number];
  children: ReactNode;
}): JSX.Element {
  return (
    <KitStage mode={palette.mode} base={palette.base} intensity={palette.intensity}>
      {children}
    </KitStage>
  );
}
