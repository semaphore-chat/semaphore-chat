import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectField, type SelectFieldProps, type SelectOption } from '../../kit';
import { tokens } from '../../theme/generated/tokens';
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
    const clicker = userEvent.setup({ pointerEventsCheck: 0 });
    await clicker.click(nobody);
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

  it('clicking the label focuses the combobox and leaves the list closed', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.click(screen.getByText('Who can DM you'));
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('the open list is named by the label', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox', { name: 'Who can DM you' })).toBeInTheDocument();
  });

  it('ref receives the combobox element, so a form can focus it', () => {
    const ref = { current: null as HTMLElement | null };
    renderWithKit(<Controlled ref={ref} />);
    expect(ref.current).toBe(screen.getByRole('combobox'));
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('typing a letter jumps to the matching option', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('F');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Friends only' }));
  });

  it('Tab closes the list and returns focus to the combobox; the next Tab moves on', async () => {
    const { user } = renderWithKit(
      <>
        <Controlled />
        <button>after</button>
      </>,
    );
    await user.click(screen.getByRole('combobox'));
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }));
  });

  it('ArrowUp opens the list from the combobox', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.tab();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('opening by keyboard focuses the selected option', async () => {
    const { user } = renderWithKit(<Controlled initial="friends" />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Friends only' }));
  });

  it('the menu uses the light shadow in light mode and the dark one in dark mode', async () => {
    const { user, unmount } = renderWithKit(<Controlled />, { mode: 'light' });
    await user.click(screen.getByRole('combobox'));
    const paper = screen.getByRole('listbox').closest('.MuiPaper-root') as HTMLElement;
    expect(getComputedStyle(paper).boxShadow).toBe(tokens.shadow.overlay.cssLight);
    unmount();
    const dark = renderWithKit(<Controlled />, { mode: 'dark' });
    await dark.user.click(screen.getByRole('combobox'));
    const darkPaper = screen.getByRole('listbox').closest('.MuiPaper-root') as HTMLElement;
    expect(getComputedStyle(darkPaper).boxShadow).toBe(tokens.shadow.overlay.css);
  });
});
