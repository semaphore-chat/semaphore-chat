import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Menu, type MenuEntry, type MenuProps } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function items(handlers: Record<string, () => void> = {}): MenuEntry[] {
  const on = (id: string) => handlers[id] ?? (() => {});
  return [
    { id: 'reply', label: 'Reply', icon: 'Reply', shortcut: ['R'], onSelect: on('reply') },
    { id: 'pin', label: 'Pin message', disabled: true, onSelect: on('pin') },
    { id: 'edit', label: 'Edit', onSelect: on('edit') },
    { id: 'd1', divider: true },
    { id: 'delete', label: 'Delete', icon: 'Trash2', tone: 'danger', shortcut: ['Shift', 'D'], onSelect: on('delete') },
  ];
}

/** A trigger button that owns the menu, as a screen would. */
function Harness({ handlers, onClose, ...rest }: { handlers?: Record<string, () => void>; onClose?: () => void } & Partial<MenuProps>) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button
        ref={(node) => {
          ref.current = node;
          setAnchor(node);
        }}
        onClick={() => setOpen(true)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Options
      </Button>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        label="Message options"
        items={items(handlers)}
        {...rest}
      />
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Options' });

describe('Menu', () => {
  it('renders nothing while closed', () => {
    renderWithKit(<Harness />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens a menu named by label with its items', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    const menu = screen.getByRole('menu', { name: 'Message options' });
    expect(menu).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'ReplyR',
      'Pin message',
      'Edit',
      'DeleteShiftD',
    ]);
  });

  it('focuses the first item on open', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Reply/ }));
  });

  it('arrows move focus and skip a disabled item; Home and End jump', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Delete/ }));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Reply/ }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Delete/ }));
  });

  it('typing a letter focuses the first item starting with it', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    await user.keyboard('d');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Delete/ }));
    await user.keyboard('e');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Delete/ }));
  });

  it('Enter calls onSelect, then onClose', async () => {
    const order: string[] = [];
    const { user } = renderWithKit(
      <Harness handlers={{ edit: () => order.push('select') }} onClose={() => order.push('close')} />,
    );
    await user.click(trigger());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(order).toEqual(['select', 'close']);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('a click selects an item', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithKit(<Harness handlers={{ reply: onSelect }} />);
    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: /^Reply/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('a disabled item is exposed as disabled and a scripted click does nothing', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness handlers={{ pin: onSelect }} onClose={onClose} />);
    await user.click(trigger());
    const pin = screen.getByRole('menuitem', { name: 'Pin message' });
    expect(pin).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(pin);
    fireEvent.keyDown(pin, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Escape calls onClose and returns focus to the trigger', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(trigger());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger());
  });

  it('an outside press calls onClose', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(trigger());
    const menu = screen.getByRole('menu');
    // The press lands on MUI's invisible catcher, the menu root's first child.
    await user.click(menu.closest('[role="presentation"]')!.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a divider is a separator and takes no focus', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /^Delete/ })).toHaveFocus();
  });

  it('shortcut keys render as kbd, one per key', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    const keys = screen.getAllByText((_, node) => node?.tagName === 'KBD');
    expect(keys.map((key) => key.textContent)).toEqual(['R', 'Shift', 'D']);
  });

  it('a danger item is an ordinary menuitem to assistive technology', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(trigger());
    const del = screen.getByRole('menuitem', { name: /^Delete/ });
    expect(del).not.toHaveAttribute('aria-disabled');
    expect(del).not.toHaveAttribute('aria-invalid');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Menu open={false} anchor={null} onClose={() => {}} label="x" items={[]} className="x" />,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
