import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Button, Dialog, TextField, type DialogProps } from '../../kit';
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
}: { onClose?: () => void; size?: DialogProps['size']; description?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete channel</Button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
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

  it('Escape calls onClose and returns focus to the opener', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(opener());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener());
  });

  it('a press on the scrim calls onClose', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog');
    await user.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
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
    const backdrop = screen.getByRole('dialog').parentElement!.previousElementSibling as HTMLElement;
    expect(getComputedStyle(backdrop).backgroundColor).not.toBe('');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Dialog open={false} onClose={() => {}} title="x" actions={null} className="x" />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
