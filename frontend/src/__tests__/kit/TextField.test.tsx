import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import { TextField, type TextFieldProps } from '../../kit';
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

function Controlled({
  onChange = () => {},
  initial = '',
  ...rest
}: { onChange?: (value: string) => void; initial?: string } & Partial<TextFieldProps>) {
  const [value, setValue] = useState(initial);
  return (
    <TextField
      label="Display name"
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      {...rest}
    />
  );
}

describe('TextField', () => {
  it('is an input found by its label', () => {
    renderWithKit(<Controlled />);
    expect(screen.getByLabelText('Display name')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeInTheDocument();
  });

  it('typing calls onChange with the full new string and shows it', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} initial="al" />);
    await user.type(screen.getByLabelText('Display name'), 'ex');
    expect(onChange).toHaveBeenNthCalledWith(1, 'ale');
    expect(onChange).toHaveBeenLastCalledWith('alex');
    expect(screen.getByLabelText('Display name')).toHaveValue('alex');
  });

  it('is controlled: a parent that ignores onChange keeps the old value', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<TextField label="X" value="abc" onChange={onChange} />);
    await user.type(screen.getByLabelText('X'), 'd');
    expect(onChange).toHaveBeenCalledWith('abcd');
    expect(screen.getByLabelText('X')).toHaveValue('abc');
  });

  it('helper is the description', () => {
    renderWithKit(<Controlled helper="Shown to everyone" />);
    const input = screen.getByLabelText('Display name');
    expect(input).toHaveAccessibleDescription('Shown to everyone');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('error is announced with the field instead of the helper', () => {
    renderWithKit(<TextField label="Name" value="" onChange={() => {}} helper="Help" error="No spaces" />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('No spaces');
    expect(screen.queryByText('Help')).not.toBeInTheDocument();
  });

  it('removing the error removes aria-invalid and the message', async () => {
    function Toggle() {
      const [error, setError] = useState<string | undefined>('Bad');
      return (
        <>
          <TextField label="Name" value="" onChange={() => {}} error={error} helper="Help" />
          <button onClick={() => setError(undefined)}>fix</button>
        </>
      );
    }
    const { user } = renderWithKit(<Toggle />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByText('fix'));
    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Bad')).not.toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('Help');
  });

  it('required sets aria-required and shows a marker outside the name', () => {
    renderWithKit(<Controlled required />);
    const input = screen.getByRole('textbox', { name: 'Display name' });
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('required')).toBeInTheDocument();
  });

  it('labelHidden keeps the accessible name', () => {
    renderWithKit(<Controlled labelHidden />);
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeInTheDocument();
  });

  it('multiline renders a textarea', () => {
    renderWithKit(<Controlled multiline rows={4} />);
    const area = screen.getByRole('textbox', { name: 'Display name' });
    expect(area).toBeInstanceOf(HTMLTextAreaElement);
    expect(area).toHaveAttribute('rows', '4');
  });

  it('multiline without rows autosizes: no fixed rows attribute; with rows it is fixed', () => {
    // jsdom cannot measure text, so growth itself is not testable here.
    const { rerender } = renderWithKit(<Controlled multiline />);
    expect(screen.getByRole('textbox', { name: 'Display name' })).not.toHaveAttribute('rows');
    rerender(<Controlled multiline rows={2} />);
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveAttribute('rows', '2');
  });

  it('a one-row multiline field is as tall as a single-line field', () => {
    renderWithKit(
      <>
        <TextField label="One" value="" onChange={() => {}} />
        <TextField label="Many" value="" onChange={() => {}} multiline rows={1} />
      </>,
    );
    const height = (label: string) => {
      const root = screen.getByLabelText(label).closest('.MuiInputBase-root') as HTMLElement;
      const style = getComputedStyle(root);
      return (
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth) +
        tokens.text.body.line
      );
    };
    expect(height('Many')).toBe(tokens.control.lg);
    expect(height('One')).toBeLessThanOrEqual(tokens.control.lg);
  });

  it('an empty error string counts as no error: the helper shows and the field is valid', () => {
    renderWithKit(<TextField label="Name" value="" onChange={() => {}} helper="Help" error="" />);
    const input = screen.getByLabelText('Name');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('Help');
  });

  it('does not accept type number', () => {
    renderWithKit(
      // @ts-expect-error -- number entry will be its own component.
      <TextField label="X" value="" onChange={() => {}} type="number" />,
    );
    expect(screen.getByLabelText('X')).toBeInTheDocument();
  });

  it('password type is not a textbox', () => {
    renderWithKit(<Controlled type="password" />);
    expect(screen.getByLabelText('Display name')).toHaveAttribute('type', 'password');
  });

  it('startIcon renders an svg and does not change the name', () => {
    const { container } = renderWithKit(<Controlled startIcon="Search" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeInTheDocument();
  });

  it('disabled disables the input and blocks typing', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled disabled onChange={onChange} />);
    const input = screen.getByLabelText('Display name');
    expect(input).toBeDisabled();
    await user.type(input, 'x');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards ref, id, name, autoComplete, maxLength and placeholder', () => {
    const ref = { current: null as HTMLInputElement | HTMLTextAreaElement | null };
    renderWithKit(
      <Controlled ref={ref} id="nm" name="display" autoComplete="nickname" maxLength={8} placeholder="Your name" />,
    );
    const input = screen.getByLabelText('Display name');
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('id', 'nm');
    expect(input).toHaveAttribute('name', 'display');
    expect(input).toHaveAttribute('autocomplete', 'nickname');
    expect(input).toHaveAttribute('maxlength', '8');
    expect(input).toHaveAttribute('placeholder', 'Your name');
  });

  it('calls onKeyDown', async () => {
    const onKeyDown = vi.fn();
    const { user } = renderWithKit(<Controlled onKeyDown={onKeyDown} />);
    await user.type(screen.getByLabelText('Display name'), '{Enter}');
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));
  });

  it('has one Tab stop', async () => {
    const { user } = renderWithKit(<Controlled />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Display name'));
    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });

  it('round shape has a larger border radius than field', () => {
    renderWithKit(
      <>
        <TextField label="A" value="" onChange={() => {}} />
        <TextField label="B" value="" onChange={() => {}} shape="round" />
      </>,
    );
    const radius = (label: string) => {
      const root = screen.getByLabelText(label).closest('.MuiInputBase-root') as HTMLElement;
      return parseFloat(getComputedStyle(root).borderRadius);
    };
    expect(radius('B')).toBeGreaterThan(radius('A'));
    expect(radius('A')).toBeGreaterThan(0);
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <TextField label="X" value="" onChange={() => {}} className="x" />,
    );
    expect(screen.getByLabelText('X')).toBeInTheDocument();
  });
});
