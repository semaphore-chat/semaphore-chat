/**
 * The Lounge's shortcut sheet (PR 10e, `shell/lounge/frame/LoungeShortcuts.tsx`): Ctrl+/ (⌘/ on a Mac) at tablet
 * and desktop width opens it. Every shortcut by group, its keys as key caps.
 */
import { useState } from 'react';
import { Button } from '../../kit';
import { ShortcutSheet as SheetOfShortcuts } from '../../shell/lounge/frame/LoungeShortcuts';
import type { ModeName } from '../../theme/derive/derivePalette';
import { KitStage } from '../fixtures/kitStory';
import { PageBehind } from '../kit/kitOverlayAnchor';

function Page({ mode, mac = false }: { mode: ModeName; mac?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <KitStage mode={mode}>
      <PageBehind />
      <Button onClick={() => setOpen(true)}>Keyboard shortcuts</Button>
      <SheetOfShortcuts open={open} onClose={() => setOpen(false)} mac={mac} />
    </KitStage>
  );
}

/** The sheet with Windows and Linux keys. */
export const ShortcutSheet = () => <Page mode="dark" />;

/** Light. */
export const ShortcutSheetLight = () => <Page mode="light" />;

/** A Mac's keys: ⌘, ⌥ and ⇧. */
export const ShortcutSheetMac = () => <Page mode="dark" mac />;

// A phone has no keyboard shortcuts: the sheet only opens at tablet and desktop width.
ShortcutSheet.meta = { viewports: ['tablet', 'desktop'] };
ShortcutSheetLight.meta = { viewports: ['tablet', 'desktop'] };
ShortcutSheetMac.meta = { viewports: ['tablet', 'desktop'] };
