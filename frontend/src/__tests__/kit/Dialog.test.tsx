import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Button, Dialog, IconButton, SelectField, TextField, Tooltip, type DialogProps, type ModalCloseReason } from '../../kit';
import { derivePalette } from '../../theme/derive/derivePalette';
import { parseHex } from '../../theme/derive/oklch';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function Harness({
  onClose,
  size,
  description = 'This removes the channel for everyone.',
}: { onClose?: (reason?: ModalCloseReason) => void; size?: DialogProps['size']; description?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete channel</Button>
      <Dialog
        open={open}
        onClose={(reason) => {
          onClose?.(reason);
          setOpen(false);
        }}
        title="Delete #memes?"
        description={description}
        size={size}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger">Delete</Button>
          </>
        }
      >
        <TextField label="Type the name" value="" onChange={() => {}} />
      </Dialog>
    </>
  );
}

const opener = () => screen.getByRole('button', { name: 'Delete channel' });

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    renderWithKit(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal dialog named by its title and described by its description', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog', { name: 'Delete #memes?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('This removes the channel for everyone.');
  });

  it('has no description when none is given', async () => {
    const { user } = renderWithKit(<Harness description="" />);
    await user.click(opener());
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('moves focus to the first button in actions', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('Tab cycles inside the dialog', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Escape calls onClose('escape') and returns focus to the opener", async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(opener());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('escape');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener());
  });

  it("a press on the scrim calls onClose('scrim') and returns focus to the opener", async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog');
    await user.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('scrim');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener());
  });

  it('a press inside the panel does not close it', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(opener());
    await user.click(screen.getByText('Delete #memes?'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks the page scroll while open and releases it on close', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
  });

  it('the page behind is hidden from assistive technology while open', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(screen.queryByRole('button', { name: 'Delete channel' })).not.toBeInTheDocument();
  });

  it('sm is narrower than md and both follow the layout tokens', async () => {
    const small = renderWithKit(<Harness size="sm" />);
    await small.user.click(opener());
    const smWidth = getComputedStyle(screen.getByRole('dialog')).maxWidth;
    small.unmount();
    const medium = renderWithKit(<Harness size="md" />);
    await medium.user.click(opener());
    const mdWidth = getComputedStyle(screen.getByRole('dialog')).maxWidth;
    expect(smWidth).toBe(`${tokens.layout.dialogSm}px`);
    expect(mdWidth).toBe(`${tokens.layout.dialogMd}px`);
    expect(tokens.layout.dialogSm).toBeLessThan(tokens.layout.dialogMd);
  });

  it('defaults to the small size', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(getComputedStyle(screen.getByRole('dialog')).maxWidth).toBe(`${tokens.layout.dialogSm}px`);
  });

  it('the scrim is the palette scrim colour', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    const backdrop = document.querySelector('.MuiBackdrop-root') as HTMLElement;
    const { scrim } = derivePalette('#8E75FF', 'dark', 'minimal');
    const [r, g, b] = parseHex(scrim.slice(0, 7));
    const alpha = Number((Number.parseInt(scrim.slice(7, 9), 16) / 255).toFixed(2));
    expect(getComputedStyle(backdrop).backgroundColor).toBe(`rgba(${r}, ${g}, ${b}, ${alpha})`);
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Dialog open={false} onClose={() => {}} title="x" actions={null} className="x" />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Shift+Tab from the first action wraps to the last control', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('focus starts on the first action even when the body holds a text field', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(screen.getByRole('textbox', { name: 'Type the name' })).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});

describe('Dialog with overlays inside', () => {
  function WithSelect({ onClose }: { onClose: () => void }) {
    const [value, setValue] = useState('');
    return (
      <Dialog open onClose={onClose} title="Privacy" actions={<Button>Save</Button>}>
        <SelectField
          label="Who can DM you"
          value={value}
          onChange={setValue}
          options={[
            { value: 'everyone', label: 'Everyone' },
            { value: 'friends', label: 'Friends only' },
          ]}
        />
      </Dialog>
    );
  }

  it('a SelectField inside opens, selects and returns focus to the combobox', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<WithSelect onClose={onClose} />);
    await user.click(await screen.findByRole('combobox', { name: 'Who can DM you' }));
    await user.click(await screen.findByRole('option', { name: 'Friends only' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    const combobox = screen.getByRole('combobox', { name: 'Who can DM you' });
    expect(combobox).toHaveTextContent('Friends only');
    await waitFor(() => expect(combobox).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape in the open list closes only the list', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<WithSelect onClose={onClose} />);
    await user.click(await screen.findByRole('combobox'));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Privacy' })).toBeInTheDocument();
  });

  it('Escape while a Tooltip inside is open closes only the Tooltip', async () => {
    const onClose = vi.fn();
    // jsdom's :focus-visible heuristic depends on the previous focus target, which a dialog's
    // programmatic first focus confuses; keyboard focus is what this test needs, so say so.
    const matches = Element.prototype.matches;
    const spy = vi
      .spyOn(Element.prototype, 'matches')
      .mockImplementation(function (this: Element, selector: string) {
        return selector === ':focus-visible' ? this === document.activeElement : matches.call(this, selector);
      });
    try {
      const { user } = renderWithKit(
        <Dialog
          open
          onClose={onClose}
          title="Tips"
          actions={
            <>
              <Button>Later</Button>
              <Tooltip label="Dismiss the tip">
                <IconButton icon="X" label="Dismiss" />
              </Tooltip>
            </>
          }
        />,
      );
      await waitFor(() => expect(screen.getByRole('button', { name: 'Later' })).toHaveFocus());
      await user.tab();
      await screen.findByRole('tooltip');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
