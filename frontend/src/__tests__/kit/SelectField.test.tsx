import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { SelectField, type SelectFieldProps, type SelectOption } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const OPTIONS: SelectOption[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends only' },
  { value: 'nobody', label: 'Nobody', disabled: true },
];

function Controlled({
  onChange = () => {},
  initial = '',
  ...rest
}: { onChange?: (value: string) => void; initial?: string } & Partial<SelectFieldProps>) {
  const [value, setValue] = useState(initial);
  return (
    <SelectField
      label="Who can DM you"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      {...rest}
    />
  );
}

describe('SelectField', () => {
  it('is a combobox named by label showing the selected option', () => {
    renderWithKit(<Controlled initial="friends" />);
    const box = screen.getByRole('combobox', { name: 'Who can DM you' });
    expect(box).toHaveTextContent('Friends only');
  });

  it('shows the placeholder when nothing is selected', () => {
    renderWithKit(<Controlled placeholder="Choose one" />);
    expect(screen.getByRole('combobox', { name: 'Who can DM you' })).toHaveTextContent('Choose one');
  });

  it('opens a list of options, chooses one, calls onChange and closes', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Everyone', 'Friends only', 'Nobody']);
    await user.click(screen.getByRole('option', { name: 'Friends only' }));
    expect(onChange).toHaveBeenCalledWith('friends');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveTextContent('Friends only');
  });

  it('marks the selected option', async () => {
    const { user } = renderWithKit(<Controlled initial="everyone" />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'Everyone' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Friends only' })).toHaveAttribute('aria-selected', 'false');
  });

  it('Escape closes the list and returns focus to the combobox', async () => {
    const { user } = renderWithKit(<Controlled />);
    const box = screen.getByRole('combobox');
    await user.click(box);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(box);
  });

  it('opens and chooses from the keyboard', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('friends');
  });

  it('a disabled option cannot be chosen', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    const nobody = screen.getByRole('option', { name: 'Nobody' });
    expect(nobody).toHaveAttribute('aria-disabled', 'true');
    await user.click(nobody).catch(() => undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is controlled: a parent that ignores onChange keeps the old value', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(
      <SelectField label="X" options={OPTIONS} value="everyone" onChange={onChange} />,
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Friends only' }));
    expect(onChange).toHaveBeenCalledWith('friends');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByRole('combobox')).toHaveTextContent('Everyone');
  });

  it('helper is the description', () => {
    renderWithKit(<Controlled helper="Pick wisely" />);
    const box = screen.getByRole('combobox');
    expect(box).toHaveAccessibleDescription('Pick wisely');
    expect(box).not.toHaveAttribute('aria-invalid');
  });

  it('error replaces the helper and sets aria-invalid; clearing removes both', async () => {
    function Toggle() {
      const [error, setError] = useState<string | undefined>('Required');
      return (
        <>
          <SelectField label="Role" options={OPTIONS} value="" onChange={() => {}} helper="Help" error={error} />
          <button onClick={() => setError(undefined)}>fix</button>
        </>
      );
    }
    const { user } = renderWithKit(<Toggle />);
    const box = screen.getByRole('combobox', { name: 'Role' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Required');
    expect(screen.queryByText('Help')).not.toBeInTheDocument();
    await user.click(screen.getByText('fix'));
    expect(box).not.toHaveAttribute('aria-invalid');
    expect(box).toHaveAccessibleDescription('Help');
  });

  it('disabled cannot be opened', async () => {
    const { user } = renderWithKit(<Controlled disabled />);
    const box = screen.getByRole('combobox');
    expect(box).toHaveAttribute('aria-disabled', 'true');
    await user.click(box);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('labelHidden keeps the accessible name', () => {
    renderWithKit(<Controlled labelHidden />);
    expect(screen.getByRole('combobox', { name: 'Who can DM you' })).toBeInTheDocument();
  });

  it('forwards id to the combobox', () => {
    renderWithKit(<Controlled id="sel" />);
    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'sel');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <SelectField label="X" options={OPTIONS} value="" onChange={() => {}} className="x" />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
