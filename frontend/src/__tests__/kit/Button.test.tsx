import { createRef, type FormEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { Button, type ButtonVariant } from '../../kit';
import { buttonLook } from '../../kit/controls/buttonLook';
import { derivePalette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { renderWithKit } from '../test-utils/renderWithKit';

/** A colour the browser has normalised, so a hex and its painted rgb() compare equal. */
function computed(property: 'color' | 'backgroundColor', value: string): string {
  const probe = document.createElement('div');
  probe.style[property] = value;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe)[property];
  probe.remove();
  return resolved;
}

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('Button', () => {
  it('renders a button with type "button" and its label', () => {
    renderWithKit(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('passes type="submit" through', () => {
    renderWithKit(<Button type="submit">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'submit');
  });

  it('calls onClick once per click', async () => {
    const onClick = vi.fn();
    const { user } = renderWithKit(<Button onClick={onClick}>Save</Button>);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe('while loading', () => {
    it('is busy by ARIA state, not natively disabled', () => {
      renderWithKit(<Button loading>Save</Button>);
      const button = screen.getByRole('button', { name: 'Save' });
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      expect(screen.getByRole('progressbar', { hidden: true })).toBeInTheDocument();
    });

    it('keeps focus when it becomes busy', () => {
      const { rerender } = renderWithKit(<Button>Save</Button>);
      const button = screen.getByRole('button', { name: 'Save' });
      button.focus();
      expect(document.activeElement).toBe(button);

      rerender(<Button loading>Save</Button>);

      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(document.activeElement).toBe(button);
    });

    it('ignores Enter and clicks', async () => {
      const onClick = vi.fn();
      const { user } = renderWithKit(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Save' });

      button.focus();
      await user.keyboard('{Enter}');
      await user.click(button);

      expect(onClick).not.toHaveBeenCalled();
    });

    it('does not submit its form', async () => {
      const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
      const form = (loading: boolean) => (
        <form onSubmit={onSubmit}>
          <input aria-label="Name" />
          <Button type="submit" loading={loading}>
            Send
          </Button>
        </form>
      );
      const { user, rerender } = renderWithKit(form(false));

      await user.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);

      rerender(form(true));

      await user.click(screen.getByRole('button', { name: 'Send' }));
      await user.type(screen.getByRole('textbox', { name: 'Name' }), '{Enter}');

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('puts the spinner in the icon slot instead of the icon', () => {
      renderWithKit(
        <Button startIcon={<svg data-testid="icon" />} loading>
          Save
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Save' });

      expect(screen.queryByTestId('icon')).toBeNull();
      expect(screen.getByRole('progressbar', { hidden: true }).parentElement).toBe(
        button.firstElementChild,
      );
    });
  });

  it('disabled wins over loading: disabled, not busy, no spinner', () => {
    renderWithKit(
      <Button disabled loading startIcon={<svg data-testid="icon" />}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('disabled wins over loading without an icon: the label stays visible', () => {
    renderWithKit(
      <Button disabled loading>
        Save
      </Button>,
    );
    expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();
    expect(screen.getByText('Save')).not.toHaveStyle({ opacity: '0' });
  });

  it('ignores clicks when disabled', async () => {
    const onClick = vi.fn();
    renderWithKit(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not busy by default', () => {
    renderWithKit(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
  });

  it('renders the start icon before the label', () => {
    renderWithKit(<Button startIcon={<svg data-testid="icon" />}>Save</Button>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('forwards a ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    renderWithKit(<Button ref={ref}>Save</Button>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Save' }));
  });

  it('takes its accessible name from aria-label', () => {
    renderWithKit(<Button aria-label="Close dialog">×</Button>);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
  });

  it('does not accept props outside its named set', () => {
    renderWithKit(
      // @ts-expect-error -- ButtonProps names the props a component may pass; className is not one.
      <Button className="custom">Save</Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('paints primary with the accent and soft with the fill', () => {
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    renderWithKit(
      <>
        <Button variant="primary">P</Button>
        <Button>S</Button>
        <Button variant="danger">D</Button>
        <Button variant="ghost">G</Button>
        <Button variant="text">T</Button>
        <Button variant="quietDanger">Q</Button>
      </>,
    );
    const style = (name: string) => getComputedStyle(screen.getByRole('button', { name }));
    expect(style('P').backgroundColor).toBe(computed('backgroundColor', palette.accent));
    expect(style('P').color).toBe(computed('color', palette.onAccent));
    expect(style('S').backgroundColor).toBe(computed('backgroundColor', palette.fill));
    expect(style('S').color).toBe(computed('color', palette.text));
    expect(style('D').backgroundColor).toBe(computed('backgroundColor', palette.danger));
    expect(style('D').color).toBe(computed('color', palette.onDanger));
    expect(style('G').color).toBe(computed('color', palette.textSecondary));
    expect(style('T').color).toBe(computed('color', palette.accentText));
    expect(style('Q').color).toBe(computed('color', palette.danger));
    expect(style('Q').backgroundColor).toBe(computed('backgroundColor', palette.fill));
  });

  it('sizes by token and is a pill', () => {
    renderWithKit(
      <>
        <Button size="sm">A</Button>
        <Button>B</Button>
        <Button size="lg">C</Button>
      </>,
    );
    expect(getComputedStyle(screen.getByRole('button', { name: 'A' })).height).toBe('32px');
    const md = getComputedStyle(screen.getByRole('button', { name: 'B' }));
    expect(md.height).toBe('40px');
    expect(md.borderRadius).toBe('9999px');
    expect(getComputedStyle(screen.getByRole('button', { name: 'C' })).height).toBe('48px');
  });

  it('fills its container when fullWidth', () => {
    renderWithKit(<Button fullWidth>Wide</Button>);
    expect(getComputedStyle(screen.getByRole('button', { name: 'Wide' })).width).toBe('100%');
  });

  it('has no ripple', async () => {
    const { user, container } = renderWithKit(<Button>Save</Button>);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(container.querySelector('[class*="MuiTouchRipple"]')).toBeNull();
  });
});

describe('buttonLook', () => {
  const palette = derivePalette('#8E75FF', 'dark', 'minimal');

  const CASES: Array<{
    variant: ButtonVariant;
    background: string;
    label: string;
    stateBase: string;
    hover: number;
    pressed: number;
  }> = [
    {
      variant: 'primary',
      background: palette.accent,
      label: palette.onAccent,
      stateBase: palette.accent,
      hover: tokens.state.hoverOnFill,
      pressed: tokens.state.pressedOnFill,
    },
    {
      variant: 'danger',
      background: palette.danger,
      label: palette.onDanger,
      stateBase: palette.danger,
      hover: tokens.state.hoverOnFill,
      pressed: tokens.state.pressedOnFill,
    },
    {
      variant: 'soft',
      background: palette.fill,
      label: palette.text,
      stateBase: palette.fill,
      hover: tokens.state.hover,
      pressed: tokens.state.pressed,
    },
    {
      variant: 'quietDanger',
      background: palette.fill,
      label: palette.danger,
      stateBase: palette.fill,
      hover: tokens.state.hover,
      pressed: tokens.state.pressed,
    },
    {
      variant: 'ghost',
      background: 'transparent',
      label: palette.textSecondary,
      stateBase: palette.surface,
      hover: tokens.state.hover,
      pressed: tokens.state.pressed,
    },
    {
      variant: 'text',
      background: 'transparent',
      label: palette.accentText,
      stateBase: palette.surface,
      hover: tokens.state.hover,
      pressed: tokens.state.pressed,
    },
  ];

  it.each(CASES)(
    '$variant',
    ({ variant, background, label, stateBase, hover, pressed }) => {
      expect(buttonLook(palette, variant)).toEqual({ background, label, stateBase, hover, pressed });
    },
  );
});
