import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Button, Popover, Sheet, SelectField, TextField } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';
import { rulesFor } from './cssRules';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function Harness({ onClose, actions, long = false }: { onClose?: () => void; actions?: boolean; long?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>All communities</Button>
      <Sheet
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="All communities"
        actions={actions ? <Button variant="primary">Done</Button> : undefined}
      >
        <TextField label="Search" value="" onChange={() => undefined} />
        {long && Array.from({ length: 40 }, (_, i) => <p key={i}>Row {i}</p>)}
      </Sheet>
    </>
  );
}

const opener = () => screen.getByRole('button', { name: 'All communities' });

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    renderWithKit(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal dialog named by its title', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog', { name: 'All communities' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('puts focus inside the sheet', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('Tab stays inside the sheet', async () => {
    const { user } = renderWithKit(<Harness actions />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
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

  it('the Close button calls onClose', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(opener());
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a press on the scrim calls onClose; a press inside does not', async () => {
    const onClose = vi.fn();
    const { user } = renderWithKit(<Harness onClose={onClose} />);
    await user.click(opener());
    await user.click(screen.getByRole('heading', { name: 'All communities' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks the page scroll while open and releases it on close', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
  });

  it('renders actions, and no actions row without them', async () => {
    const first = renderWithKit(<Harness actions />);
    await first.user.click(opener());
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    first.unmount();
    const second = renderWithKit(<Harness />);
    await second.user.click(opener());
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('the header stays while a long body scrolls inside the sheet', async () => {
    const { user } = renderWithKit(<Harness long actions />);
    await user.click(opener());
    const dialog = screen.getByRole('dialog');
    const body = screen.getByText('Row 0').parentElement as HTMLElement;
    expect(getComputedStyle(body).overflowY).toBe('auto');
    expect(getComputedStyle(dialog).overflow).toBe('hidden');
    // The title and the actions are siblings of the body, not inside it.
    expect(body.contains(screen.getByRole('heading', { name: 'All communities' }))).toBe(false);
    expect(body.contains(screen.getByRole('button', { name: 'Done' }))).toBe(false);
  });

  it('md is the dialog width; lg is wider and capped at twice the small dialog', async () => {
    const small = renderWithKit(<Sheet open onClose={() => undefined} title="x">y</Sheet>);
    const md = getComputedStyle(screen.getByRole('dialog')).maxWidth;
    small.unmount();
    renderWithKit(<Sheet open onClose={() => undefined} title="x" size="lg">y</Sheet>);
    const lg = getComputedStyle(screen.getByRole('dialog')).maxWidth;
    expect(md).toBe(`${tokens.layout.dialogMd}px`);
    expect(lg).toBe(`${2 * tokens.layout.dialogSm}px`);
  });

  // jsdom does not evaluate media queries, so the phone form cannot be rendered here; the real
  // proof is the 390 px screenshot of the kit-sheet--phone story. This reads the declarations of
  // the rule at the phone breakpoint by property name (not serialised text) and checks the
  // breakpoint is the token's.
  it('declares the bottom-sheet form in a rule at the phone breakpoint (declarations only)', () => {
    renderWithKit(<Sheet open onClose={() => undefined} title="x">y</Sheet>);
    const dialog = screen.getByRole('dialog');
    const phone = rulesFor(dialog, '').filter((rule) =>
      (rule.parentRule as CSSMediaRule | null)?.conditionText?.includes(`max-width: ${tokens.breakpoint.phone}px`),
    );
    const declared = (property: string) => phone.map((rule) => rule.style.getPropertyValue(property)).find(Boolean);
    expect(declared('max-width')).toBe('100%');
    expect(declared('border-radius')).toBe(`${tokens.radius.island}px ${tokens.radius.island}px 0 0`);
    expect(declared('animation')).toMatch(/ease-out/);
  });

  it('pads the bottom of the actions row by the safe-area inset on a phone', () => {
    renderWithKit(<Sheet open onClose={() => undefined} title="x" actions={<Button>Done</Button>}>y</Sheet>);
    const actions = screen.getByRole('button', { name: 'Done' }).parentElement as HTMLElement;
    const phone = rulesFor(actions, '').filter((rule) =>
      (rule.parentRule as CSSMediaRule | null)?.conditionText?.includes(`max-width: ${tokens.breakpoint.phone}px`),
    );
    const padding = phone.map((rule) => rule.style.getPropertyValue('padding-bottom')).find(Boolean);
    expect(padding).toContain('env(safe-area-inset-bottom)');
    expect(padding).toContain(`${tokens.space.md}px`);
  });

  it('pads the bottom of the body by the safe-area inset when there are no actions', () => {
    renderWithKit(<Sheet open onClose={() => undefined} title="x">body text</Sheet>);
    const body = screen.getByText('body text');
    const phone = rulesFor(body, '').filter((rule) =>
      (rule.parentRule as CSSMediaRule | null)?.conditionText?.includes(`max-width: ${tokens.breakpoint.phone}px`),
    );
    expect(phone.map((rule) => rule.style.getPropertyValue('padding-bottom')).find(Boolean)).toContain('env(safe-area-inset-bottom)');
  });

  it('initial focus is the Close button when there are no actions', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
  });

  it('focus returns to the opener after the Close button', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener());
  });

  it('focus returns to the opener after a scrim press', async () => {
    const { user } = renderWithKit(<Harness />);
    await user.click(opener());
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener());
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Sheet open={false} onClose={() => undefined} title="x" className="x">y</Sheet>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Sheet with overlays inside', () => {
  it('a SelectField inside opens, selects and returns focus to the combobox', async () => {
    const onClose = vi.fn();
    function WithSelect() {
      const [value, setValue] = useState('');
      return (
        <Sheet open onClose={onClose} title="Privacy">
          <SelectField
            label="Who can DM you"
            value={value}
            onChange={setValue}
            options={[
              { value: 'everyone', label: 'Everyone' },
              { value: 'friends', label: 'Friends only' },
            ]}
          />
        </Sheet>
      );
    }
    const { user } = renderWithKit(<WithSelect />);
    await user.click(await screen.findByRole('combobox', { name: 'Who can DM you' }));
    await user.click(await screen.findByRole('option', { name: 'Friends only' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    const combobox = screen.getByRole('combobox', { name: 'Who can DM you' });
    expect(combobox).toHaveTextContent('Friends only');
    await waitFor(() => expect(combobox).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a Popover opened from inside opens and Escape closes only it', async () => {
    const onClose = vi.fn();
    function WithPopover() {
      const [open, setOpen] = useState(false);
      const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
      return (
        <Sheet open onClose={onClose} title="Pop">
          <Button ref={setAnchor} onClick={() => setOpen(true)}>More</Button>
          <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label="More info">
            <Button>Inside</Button>
          </Popover>
        </Sheet>
      );
    }
    const { user } = renderWithKit(<WithPopover />);
    await user.click(await screen.findByRole('button', { name: 'More' }));
    expect(await screen.findByRole('button', { name: 'Inside' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
