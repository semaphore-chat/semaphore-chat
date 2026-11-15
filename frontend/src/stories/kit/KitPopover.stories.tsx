import { useState } from 'react';
import { Button, Popover, TextField } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';
import { PageBehind } from './kitOverlayAnchor';
import { useAnchor } from './useAnchor';
import type { ModeName } from '../../theme/derive/derivePalette';

function RenameForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('memes');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.md, width: 280, maxWidth: '100%' }}>
      <TextField label="Channel name" value={name} onChange={setName} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: tokens.space.sm }}>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onDone}>
          Save
        </Button>
      </div>
    </div>
  );
}

function OpenPopover({ padding }: { padding?: 'none' | 'md' | 'lg' }) {
  const [anchor, ref] = useAnchor();
  const [open, setOpen] = useState(true);
  return (
    <>
      <div>
        <Button ref={ref} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Rename channel
        </Button>
      </div>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label="Rename channel" padding={padding}>
        <RenameForm onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
}

const Page = ({ mode, padding }: { mode: ModeName; padding?: 'none' | 'md' | 'lg' }) => (
  <KitStage mode={mode}>
    <PageBehind />
    <OpenPopover padding={padding} />
  </KitStage>
);

/** A small form in a popover: focus starts in the field. */
export const Open = () => <Page mode="dark" padding="lg" />;

export const OpenLight = () => <Page mode="light" padding="lg" />;

/** The tighter md padding. */
export const OpenCompact = () => <Page mode="dark" padding="md" />;
