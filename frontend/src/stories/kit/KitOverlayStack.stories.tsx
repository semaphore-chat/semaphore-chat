/**
 * The overlay stack on real overlays, for checks that need a real browser
 * (the focus trap with layers inside a dialog, Escape while an input method
 * composes, a drag onto the scrim, the press a menu swallows). Each story
 * writes what happened in a log line, so a browser test can read it.
 */
import { useState, type JSX } from 'react';
import { Button, Dialog, Menu, Popover, SelectField, Text, TextField, type ModalCloseReason } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { KitStage } from '../fixtures/kitStory';
import { PageBehind } from './kitOverlayAnchor';
import { useAnchor } from './useAnchor';

/** The story's log: the latest events, newest last. Not a live region: a test reads it. */
function Log({ lines }: { lines: string[] }): JSX.Element {
  return (
    <div data-testid="overlay-log">
      <Text tone="secondary">{lines.length === 0 ? 'Nothing yet.' : lines.slice(-4).join(' · ')}</Text>
    </div>
  );
}

function useLog(): [string[], (line: string) => void] {
  const [lines, setLines] = useState<string[]>([]);
  return [lines, (line) => setLines((previous) => [...previous, line])];
}

function NestedLayers() {
  const [log, add] = useLog();
  const [dialog, setDialog] = useState(true);
  const [popover, setPopover] = useState(true);
  const [menu, setMenu] = useState(false);
  const [shade, setShade] = useState('');
  const [colourAnchor, colourRef] = useAnchor();
  const [moreAnchor, moreRef] = useAnchor();
  return (
    <>
      <Log lines={log} />
      <Button onClick={() => setDialog(true)}>Edit channel</Button>
      <Dialog
        open={dialog}
        onClose={(reason?: ModalCloseReason) => {
          add(`dialog closed (${reason ?? 'parent'})`);
          setDialog(false);
        }}
        title="Edit channel"
        description="Tab stays in here, Escape closes the innermost layer first."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary">Save</Button>
          </>
        }
      >
        <TextField label="Channel name" value="general" onChange={() => {}} />
        <div style={{ display: 'flex', gap: tokens.space.sm, marginTop: tokens.space.md }}>
          <Button ref={colourRef} onClick={() => setPopover(true)}>
            Pick colour
          </Button>
        </div>
        <Popover
          open={popover}
          anchor={colourAnchor}
          onClose={() => {
            add('popover closed');
            setPopover(false);
          }}
          label="Colour"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space.sm, width: tokens.layout.dialogSm / 2 }}>
            <SelectField
              label="Shade"
              value={shade}
              onChange={setShade}
              placeholder="Choose"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
            <Button ref={moreRef} onClick={() => setMenu(true)}>
              More
            </Button>
            <Menu
              open={menu}
              anchor={moreAnchor}
              onClose={() => {
                add('menu closed');
                setMenu(false);
              }}
              label="More"
              items={[
                { id: 'reset', label: 'Reset colour', onSelect: () => add('reset') },
                { id: 'copy', label: 'Copy colour', onSelect: () => add('copy') },
              ]}
            />
          </div>
        </Popover>
      </Dialog>
    </>
  );
}

/** A Dialog with a Popover inside it, open; the Popover holds a select list and a Menu. */
export const NestedInDialog = () => (
  <KitStage mode="dark">
    <PageBehind />
    <NestedLayers />
  </KitStage>
);

function ComposingField() {
  const [log, add] = useLog();
  const [open, setOpen] = useState(true);
  const [anchor, ref] = useAnchor();
  const [text, setText] = useState('');
  return (
    <>
      <Log lines={log} />
      <div>
        <Button ref={ref} onClick={() => setOpen(true)}>
          Reply
        </Button>
      </div>
      <Popover
        open={open}
        anchor={anchor}
        onClose={() => {
          add('popover closed');
          setOpen(false);
        }}
        label="Reply"
        padding="lg"
      >
        <TextField label="Reply" value={text} onChange={setText} placeholder="Type with an input method" />
      </Popover>
    </>
  );
}

/** A Popover with a text field focused: Escape during composition must not close it. */
export const EscapeWhileComposing = () => (
  <KitStage mode="dark">
    <ComposingField />
  </KitStage>
);

function ScrimDialog() {
  const [log, add] = useLog();
  const [open, setOpen] = useState(true);
  return (
    <>
      <Log lines={log} />
      <div>
        <Button onClick={() => setOpen(true)}>Open again</Button>
      </div>
      <Dialog
        open={open}
        onClose={(reason?: ModalCloseReason) => {
          add(`dialog closed (${reason ?? 'parent'})`);
          setOpen(false);
        }}
        title="Leave the call?"
        description="A drag from here onto the dimmed page does not close it; a press on the dimmed page does."
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Stay
            </Button>
            <Button variant="danger" onClick={() => setOpen(false)}>
              Leave
            </Button>
          </>
        }
      />
    </>
  );
}

/** A Dialog whose log says why it closed. */
export const ScrimPress = () => (
  <KitStage mode="dark">
    <PageBehind />
    <ScrimDialog />
  </KitStage>
);

function MenuOverButton() {
  const [log, add] = useLog();
  const [open, setOpen] = useState(true);
  const [anchor, ref] = useAnchor();
  const [presses, setPresses] = useState(0);
  return (
    <>
      <Log lines={log} />
      <div style={{ display: 'flex', gap: tokens.space.md }}>
        <Button ref={ref} onClick={() => setOpen(true)}>
          Options
        </Button>
        <Button
          variant="soft"
          onClick={() => {
            setPresses((count) => count + 1);
            add('page button pressed');
          }}
        >
          {`Pressed ${presses} times`}
        </Button>
      </div>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => {
          add('menu closed');
          setOpen(false);
        }}
        label="Options"
        items={[
          { id: 'rename', label: 'Rename', onSelect: () => add('rename') },
          { id: 'mute', label: 'Mute', onSelect: () => add('mute') },
        ]}
      />
    </>
  );
}

/** An open Menu beside a page button: a press on the button closes the menu and does not press the button. */
export const MenuSwallowsPress = () => (
  <KitStage mode="dark">
    <MenuOverButton />
  </KitStage>
);
