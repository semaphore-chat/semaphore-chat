import { useState } from 'react';
import { Button, Menu, type MenuEntry, type MenuProps } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';
import { PageBehind } from './kitOverlayAnchor';
import { useAnchor } from './useAnchor';

const noop = () => undefined;

const ITEMS: MenuEntry[] = [
  { id: 'reply', label: 'Reply', icon: 'Reply', shortcut: ['R'], onSelect: noop },
  { id: 'thread', label: 'Start thread', icon: 'MessageSquare', shortcut: ['T'], onSelect: noop },
  { id: 'pin', label: 'Pin message', icon: 'Pin', disabled: true, onSelect: noop },
  { id: 'copy', label: 'Copy link', icon: 'Link', onSelect: noop },
  { id: 'd1', divider: true },
  { id: 'delete', label: 'Delete message', icon: 'Trash2', tone: 'danger', shortcut: ['Shift', 'D'], onSelect: noop },
];

function OpenMenu({
  placement,
  items = ITEMS,
  anchorAt = 'start',
}: { placement?: MenuProps['placement']; items?: MenuEntry[]; anchorAt?: 'start' | 'end' | 'bottom-end' }) {
  const [anchor, ref] = useAnchor();
  const [open, setOpen] = useState(true);
  const justify = anchorAt === 'start' ? 'flex-start' : 'flex-end';
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: justify,
          alignItems: anchorAt === 'bottom-end' ? 'flex-end' : 'flex-start',
          flex: 1,
          width: '100%',
        }}
      >
        <Button ref={ref} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)}>
          Message options
        </Button>
      </div>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label="Message options"
        items={items}
        placement={placement}
      />
    </>
  );
}

const Page = ({ mode, base, intensity, children }: { mode: ModeName; base?: string; intensity?: IntensityName; children: React.ReactNode }) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <PageBehind />
    {children}
  </KitStage>
);

/** Icons, shortcuts, a divider, a danger item and a disabled item. */
export const Open = () => (
  <Page mode="dark">
    <OpenMenu />
  </Page>
);

export const OpenLight = () => (
  <Page mode="light">
    <OpenMenu />
  </Page>
);

export const OpenTinted = () => (
  <Page mode="dark" base="#0d9488" intensity="vibrant">
    <OpenMenu />
  </Page>
);

/** The anchor at the bottom right: the menu opens upward and ends at the anchor's right edge. */
export const Placements = () => (
  <KitStage mode="dark">
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: `calc(100dvh - ${4 * tokens.layout.gutter}px)` }}>
      <OpenMenu placement="top-end" anchorAt="bottom-end" />
    </div>
  </KitStage>
);
