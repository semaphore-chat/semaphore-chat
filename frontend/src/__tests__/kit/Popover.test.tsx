import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { Button, Dialog, Menu, Popover, SelectField, TextField } from '../../kit';
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

describe('Popover holding other overlays', () => {
  function WithSelect({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [value, setValue] = useState('');
    return (
      <>
        <Button ref={setAnchor} onClick={() => setOpen(true)}>
          Settings
        </Button>
        <Popover
          open={open}
          anchor={anchor}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          label="Settings panel"
        >
          <SelectField
            label="Who can DM you"
            value={value}
            onChange={setValue}
            options={[
              { value: 'everyone', label: 'Everyone' },
              { value: 'friends', label: 'Friends only' },
            ]}
          />
        </Popover>
      </>
    );
  }

  it('choosing an option in a SelectField keeps the popover open and applies the value', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<WithSelect onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('combobox', { name: 'Who can DM you' }));
    await user.click(await screen.findByRole('option', { name: 'Friends only' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Settings panel' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Who can DM you' })).toHaveTextContent('Friends only');
  });

  it('Escape in the open list closes only the list; a second Escape closes the popover', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<WithSelect onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('combobox', { name: 'Who can DM you' }));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape in a Menu opened from the popover closes only the menu', async () => {
    const onClose = vi.fn();
    function WithMenu() {
      const [open, setOpen] = useState(true);
      const [menuOpen, setMenuOpen] = useState(false);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const [inner, setInner] = useState<HTMLElement | null>(null);
      return (
        <>
          <Button ref={setAnchor}>Open</Button>
          <Popover
            open={open}
            anchor={anchor}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            label="Panel"
          >
            <Button ref={setInner} onClick={() => setMenuOpen(true)}>
              More
            </Button>
            <Menu
              open={menuOpen}
              anchor={inner}
              onClose={() => setMenuOpen(false)}
              label="More actions"
              items={[{ id: 'a', label: 'Archive', onSelect: () => {} }]}
            />
          </Popover>
        </>
      );
    }
    const { user } = renderWithKit(<WithMenu />);
    await user.click(await screen.findByRole('button', { name: 'More' }));
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Panel' })).toBeInTheDocument();
  });

  it('a press on another button closes it and leaves focus on that button, not the anchor', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'After' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('the field inside still sees Escape before the popover closes on it', async () => {
    const onKeyDown = vi.fn();
    function Subject() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <Button ref={setAnchor}>Open</Button>
          <Popover open anchor={anchor} onClose={() => {}} label="Panel">
            <TextField label="Name" value="" onChange={() => {}} onKeyDown={onKeyDown} />
          </Popover>
        </>
      );
    }
    const { user } = renderWithKit(<Subject />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
  });

  it('Escape with focus on the anchor closes it', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(trigger());
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    act(() => trigger().focus());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Popover inside a Dialog', () => {
  function InDialog({ onPick, onDialogClose }: { onPick: () => void; onDialogClose: () => void }) {
    const [open, setOpen] = useState(false);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
      <Dialog
        open
        onClose={onDialogClose}
        title="Edit channel"
        actions={<Button>Save</Button>}
      >
        <Button ref={setAnchor} onClick={() => setOpen(true)}>
          Pick colour
        </Button>
        <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label="Colours">
          <Button onClick={onPick}>Red</Button>
          <Button>Blue</Button>
        </Popover>
      </Dialog>
    );
  }

  it('takes focus inside the dialog trap and its controls work', async () => {
    const onPick = vi.fn();
    const { user } = renderWithKit(<InDialog onPick={onPick} onDialogClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Pick colour' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Red' })).toHaveFocus());
    // The trap's interval check would have pulled focus back by now.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(screen.getByRole('button', { name: 'Red' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Red' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('Escape closes only the popover; the next one closes the dialog', async () => {
    const onDialogClose = vi.fn();
    const { user } = renderWithKit(<InDialog onPick={() => {}} onDialogClose={onDialogClose} />);
    await user.click(await screen.findByRole('button', { name: 'Pick colour' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Red' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Colours' })).not.toBeInTheDocument());
    expect(onDialogClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick colour' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(onDialogClose).toHaveBeenCalledTimes(1);
  });
});
