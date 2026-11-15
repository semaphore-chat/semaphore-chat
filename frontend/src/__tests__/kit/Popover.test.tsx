import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Button, Popover, TextField } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function Harness({ onClose, withField = true }: { onClose?: () => void; withField?: boolean }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button ref={setAnchor} onClick={() => setOpen(true)}>
        Rename
      </Button>
      <Button>After</Button>
      <Popover
        open={open}
        anchor={anchor}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        label="Rename channel"
      >
        {withField ? <TextField label="Name" value="" onChange={() => {}} /> : <span>Just text</span>}
      </Popover>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Rename' });

describe('Popover', () => {
  it('renders nothing while closed', () => {
    renderWithKit(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog named by label, not modal', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    const dialog = screen.getByRole('dialog', { name: 'Rename channel' });
    expect(dialog).not.toHaveAttribute('aria-modal', 'true');
  });

  it('moves focus to the first focusable child', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' })));
  });

  it('focuses the panel itself when nothing inside is focusable', async () => {
    const { user } = renderWithKit(<Harness withField={false} />);
    await user.click(trigger());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
  });

  it('Escape calls onClose and returns focus to the anchor', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger());
  });

  it('an outside press calls onClose', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(trigger());
    await user.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a press inside the panel or on the anchor does not close it', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(trigger());
    await user.click(screen.getByRole('textbox'));
    await user.click(trigger());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not trap Tab: focus can leave the panel', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(false);
  });

  it('does not lock page scroll', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
