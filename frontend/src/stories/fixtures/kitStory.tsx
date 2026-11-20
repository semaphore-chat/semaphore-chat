import type { JSX, ReactNode } from 'react';
import { KitProvider, KitRoot, Text } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';

const DEFAULT_BASE = '#8E75FF';

export interface KitStageProps {
  mode?: ModeName;
  base?: string;
  intensity?: IntensityName;
  children: ReactNode;
}

/**
 * The page a kit story renders on: a KitProvider and a KitRoot that fills the
 * viewport, so the Lounge ground shows instead of the old theme's background.
 * `mode` defaults to dark; every kit story sets it explicitly.
 */
export function KitStage({
  mode = 'dark',
  base = DEFAULT_BASE,
  intensity = 'minimal',
  children,
}: KitStageProps): JSX.Element {
  return (
    <KitProvider base={base} mode={mode} intensity={intensity}>
      <KitRoot
        style={{
          minHeight: '100dvh',
          padding: tokens.layout.gutter,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space.xl,
        }}
      >
        {children}
      </KitRoot>
    </KitProvider>
  );
}

/**
 * The page a layout story renders on: only the KitProvider. The layout's AppFrame paints the ground and
 * pads and fills the viewport itself, so a KitStage (which does both) would double them.
 */
export function KitFrameStage({
  mode = 'dark',
  base = DEFAULT_BASE,
  intensity = 'minimal',
  children,
}: KitStageProps): JSX.Element {
  return (
    <KitProvider base={base} mode={mode} intensity={intensity}>
      {children}
    </KitProvider>
  );
}

/** A labelled, wrapping flex row, so states sit side by side and wrap at phone width. */
export function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div style={{ marginBottom: tokens.space.sm }}>
        <Text variant="small" tone="secondary">
          {label}
        </Text>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: tokens.space.md, alignItems: 'center' }}>
        {children}
      </div>
    </div>
  );
}
