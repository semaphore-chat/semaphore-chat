import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../../kit';
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
  initial = false,
  disabled,
}: {
  onChange?: (checked: boolean) => void;
  initial?: boolean;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <Switch
      label="Notifications"
      description="Pings on mentions"
      checked={checked}
      disabled={disabled}
      onChange={(next) => {
        onChange(next);
        setChecked(next);
      }}
    />
  );
}

describe('Switch', () => {
  it('is a switch named by label and described by description', () => {
    renderWithKit(<Controlled />);
    const control = screen.getByRole('switch', { name: 'Notifications' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control).toHaveAccessibleDescription('Pings on mentions');
  });

  it('click, Space and Enter call onChange with the new value', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    const control = screen.getByRole('switch');
    await user.click(control);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(control).toHaveAttribute('aria-checked', 'true');
    control.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(false);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('clicking the label text toggles once', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.click(screen.getByText('Notifications'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('has one Tab stop', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('switch'));
    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });

  it('disabled blocks activation', async () => {
    const onChange = vi.fn();
    renderWithKit(<Controlled onChange={onChange} disabled />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const control = screen.getByRole('switch');
    expect(control).toBeDisabled();
    await user.click(control);
    await user.click(screen.getByText('Notifications'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is controlled: a parent that ignores onChange keeps the old state', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Switch label="X" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('labelHidden keeps the accessible name and description', () => {
    renderWithKit(<Switch label="Mute" description="Silences it" labelHidden checked onChange={() => {}} />);
    const control = screen.getByRole('switch', { name: 'Mute' });
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(control).toHaveAccessibleDescription('Silences it');
  });

  it('forwards ref and id', () => {
    const ref = { current: null as HTMLButtonElement | null };
    renderWithKit(<Switch label="X" id="sw" ref={ref} checked onChange={() => {}} />);
    expect(ref.current).toBe(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toHaveAttribute('id', 'sw');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Switch label="X" checked onChange={() => {}} className="x" />,
    );
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });
});
