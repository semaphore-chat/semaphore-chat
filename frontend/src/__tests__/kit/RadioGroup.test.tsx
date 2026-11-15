import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup, type RadioOption } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const OPTIONS: RadioOption[] = [
  { value: 'all', label: 'All messages', description: 'Every one' },
  { value: 'mentions', label: 'Mentions only' },
  { value: 'off', label: 'Nothing', disabled: true },
  { value: 'dm', label: 'Direct messages' },
];

function Controlled({ onChange = () => {}, disabled }: { onChange?: (value: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState('all');
  return (
    <RadioGroup
      label="Notify me"
      options={OPTIONS}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('RadioGroup', () => {
  it('is a radiogroup named by label with one radio checked', () => {
    renderWithKit(<Controlled />);
    expect(screen.getByRole('radiogroup', { name: 'Notify me' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'All messages' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Mentions only' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'All messages' })).toHaveAccessibleDescription('Every one');
  });

  it('click and label click call onChange with the value', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Mentions only' }));
    expect(onChange).toHaveBeenLastCalledWith('mentions');
    await user.click(screen.getByText('Direct messages'));
    expect(onChange).toHaveBeenLastCalledWith('dm');
    expect(screen.getByRole('radio', { name: 'Direct messages' })).toBeChecked();
  });

  it('arrows move focus and selection, skipping disabled and wrapping', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All messages' }));

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Mentions only' }));
    expect(onChange).toHaveBeenLastCalledWith('mentions');

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Direct messages' }));
    expect(onChange).toHaveBeenLastCalledWith('dm');

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All messages' }));
    expect(onChange).toHaveBeenLastCalledWith('all');

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Direct messages' }));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Mentions only' }));
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it('only the selected radio is a Tab stop', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });

  it('a disabled option is disabled and ignores clicks', async () => {
    const onChange = vi.fn();
    renderWithKit(<Controlled onChange={onChange} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const off = screen.getByRole('radio', { name: 'Nothing' });
    expect(off).toBeDisabled();
    await user.click(off);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a group-level disabled disables every radio', () => {
    renderWithKit(<Controlled disabled />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });

  it('is controlled: a parent that ignores onChange keeps the old selection', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<RadioGroup label="G" options={OPTIONS} value="all" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Mentions only' }));
    expect(onChange).toHaveBeenCalledWith('mentions');
    expect(screen.getByRole('radio', { name: 'All messages' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Mentions only' })).not.toBeChecked();
  });

  it('accepts orientation and id', () => {
    renderWithKit(<RadioGroup label="G" id="rg" orientation="horizontal" options={OPTIONS} value="all" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('id', 'rg');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <RadioGroup label="G" options={OPTIONS} value="all" onChange={() => {}} className="x" />,
    );
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('shows the group label by default and it names the group', () => {
    renderWithKit(<Controlled />);
    const text = screen.getByText('Notify me');
    expect(text).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Notify me' });
    expect(group).toHaveAttribute('aria-labelledby');
    expect(document.getElementById(group.getAttribute('aria-labelledby') ?? '')).toContainElement(text);
    expect(screen.getAllByText('Notify me')).toHaveLength(1);
  });

  it('with no checked value, Tab lands on the first enabled radio and an arrow selects the next', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(
      <RadioGroup label="Notify me" options={OPTIONS} value="" onChange={onChange} />,
    );
    expect(screen.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(0);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All messages' }));
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('mentions');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Mentions only' }));
  });

  it('labelHidden keeps the accessible name and clips the label out of the layout', () => {
    renderWithKit(
      <RadioGroup label="Notify me" labelHidden options={OPTIONS} value="all" onChange={() => {}} />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Notify me' })).toBeInTheDocument();
    const hidden = screen.getByText('Notify me').closest('[id]') as HTMLElement;
    expect(hidden).toHaveStyle({ position: 'absolute', overflow: 'hidden' });
  });
});
