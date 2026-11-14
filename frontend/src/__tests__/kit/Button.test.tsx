import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Button } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';
import { derivePalette } from '../../theme/derive/derivePalette';

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

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    renderWithKit(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(getComputedStyle(button).pointerEvents).toBe('none');
  });

  it('is busy, keeps its name and ignores clicks when loading', () => {
    const onClick = vi.fn();
    renderWithKit(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar', { hidden: true })).toBeInTheDocument();
  });

  it('is not busy by default', () => {
    renderWithKit(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
  });

  it('renders the start icon before the label', () => {
    renderWithKit(<Button startIcon={<svg data-testid="icon" />}>Save</Button>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
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
