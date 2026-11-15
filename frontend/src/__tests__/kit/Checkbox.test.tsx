import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function Controlled({
  onChange = () => {},
  disabled,
  indeterminate,
}: {
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  indeterminate?: boolean;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      label="Send reports"
      description="Weekly"
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onChange={(next) => {
        onChange(next);
        setChecked(next);
      }}
    />
  );
}

describe('Checkbox', () => {
  it('is a checkbox named by label, described by description', () => {
    renderWithKit(<Controlled />);
    const box = screen.getByRole('checkbox', { name: 'Send reports' });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription('Weekly');
  });

  it('click, Space and label click call onChange', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    const box = screen.getByRole('checkbox');
    await user.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(box).toBeChecked();
    box.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByText('Send reports'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('indeterminate reports mixed', () => {
    renderWithKit(<Controlled indeterminate />);
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'mixed');
    expect((box as HTMLInputElement).indeterminate).toBe(true);
  });

  it('a click on an indeterminate box reports the opposite of checked', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled indeterminate onChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('has one Tab stop', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('checkbox'));
    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });

  it('disabled blocks activation', async () => {
    const onChange = vi.fn();
    renderWithKit(<Controlled onChange={onChange} disabled />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    expect(screen.getByRole('checkbox')).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByText('Send reports'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is controlled: a parent that ignores onChange keeps the old state', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Checkbox label="X" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('labelHidden keeps the accessible name', () => {
    renderWithKit(<Checkbox label="Select row" labelHidden checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select row' })).toBeInTheDocument();
  });

  it('forwards ref and id', () => {
    const ref = { current: null as HTMLInputElement | null };
    renderWithKit(<Checkbox label="X" id="cb" ref={ref} checked onChange={() => {}} />);
    expect(ref.current).toBe(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).toHaveAttribute('id', 'cb');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Checkbox label="X" checked onChange={() => {}} className="x" />,
    );
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('stays indeterminate in the DOM after a click when the parent keeps it mixed', async () => {
    const { user } = renderWithKit(
      <Checkbox label="Some" checked={false} indeterminate onChange={vi.fn()} />,
    );
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    await user.click(box);
    expect(box.indeterminate).toBe(true);
    expect(box).toHaveAttribute('aria-checked', 'mixed');
  });

  it('draws the indeterminate dash and the check with the kit Icon', () => {
    const { container, rerender } = renderWithKit(
      <Checkbox label="Some" checked={false} indeterminate onChange={() => {}} />,
    );
    expect(container.querySelector('svg path')?.getAttribute('d')).toBe('M5 12h14');
    rerender(<Checkbox label="Some" checked onChange={() => {}} />);
    expect(container.querySelector('svg path')?.getAttribute('d')).not.toBe('M5 12h14');
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('passes a callback ref the input and clears it on unmount', () => {
    const ref = vi.fn();
    const { unmount } = renderWithKit(<Checkbox label="X" ref={ref} checked onChange={() => {}} />);
    expect(ref).toHaveBeenLastCalledWith(screen.getByRole('checkbox'));
    unmount();
    expect(ref).toHaveBeenLastCalledWith(null);
  });
});
