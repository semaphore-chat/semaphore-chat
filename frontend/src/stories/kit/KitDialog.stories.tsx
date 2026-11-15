import { useState } from 'react';
import { Button, Dialog, Text, TextField } from '../../kit';
import type { IntensityName, ModeName } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';
import { PageBehind } from './kitOverlayAnchor';

function ConfirmDialog({ size, withField = false }: { size?: 'sm' | 'md'; withField?: boolean }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const close = () => setOpen(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete channel</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Delete #memes?"
        description="This removes the channel and its 1,204 messages for everyone in Couch Co-op. This can't be undone."
        size={size}
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" onClick={close}>
              Delete channel
            </Button>
          </>
        }
      >
        {withField && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm }}>
            <Text tone="secondary">Type the channel name to confirm.</Text>
            <TextField label="Channel name" labelHidden placeholder="memes" value={name} onChange={setName} />
          </div>
        )}
      </Dialog>
    </>
  );
}

const Page = ({
  mode,
  base,
  intensity,
  size,
  withField,
}: {
  mode: ModeName;
  base?: string;
  intensity?: IntensityName;
  size?: 'sm' | 'md';
  withField?: boolean;
}) => (
  <KitStage mode={mode} base={base} intensity={intensity}>
    <PageBehind />
    <ConfirmDialog size={size} withField={withField} />
  </KitStage>
);

/** Title, description, Cancel first and a danger action. Focus starts on Cancel. */
export const Confirm = () => <Page mode="dark" />;

/** The medium width, with a field inside. */
export const WithContent = () => <Page mode="dark" size="md" withField />;

export const ConfirmLight = () => <Page mode="light" />;

export const ConfirmTinted = () => <Page mode="dark" base="#0d9488" intensity="vibrant" />;

/** Judge at 390 px: the buttons stack full width, the safe action on top. */
export const Phone = () => <Page mode="dark" size="md" withField />;
