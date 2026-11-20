import { useState } from 'react';
import { Button, Dialog, Popover, TextField } from '../../kit';
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

const SWATCHES = ['#8E75FF', '#0d9488', '#FF8FB8', '#FFA366'];

function PopoverInDialog() {
  const [anchor, ref] = useAnchor();
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open
      onClose={() => undefined}
      title="Edit channel"
      description="Rename it or change its colour."
      actions={
        <>
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary">Save</Button>
        </>
      }
    >
      <Button ref={ref} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Pick colour
      </Button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label="Colours" padding="md">
        <div style={{ display: 'flex', gap: tokens.space.sm }}>
          {SWATCHES.map((colour) => (
            <Button key={colour} variant="soft" size="sm" onClick={() => setOpen(false)}>
              {colour}
            </Button>
          ))}
        </div>
      </Popover>
    </Dialog>
  );
}

/** A Popover opened from a control inside a Dialog: it renders in the Dialog and takes focus. */
export const InsideDialog = () => (
  <KitStage mode="dark">
    <PageBehind />
    <PopoverInDialog />
  </KitStage>
);
