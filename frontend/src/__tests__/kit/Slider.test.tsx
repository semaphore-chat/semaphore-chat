import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Slider, type SliderProps } from '../../kit';
import { derivePalette } from '../../theme/derive/derivePalette';
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
  initial = 50,
  ...rest
}: { onChange?: (value: number) => void; initial?: number } & Partial<SliderProps>) {
  const [value, setValue] = useState(initial);
  return (
    <Slider
      label="Volume"
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      {...rest}
    />
  );
}

describe('Slider', () => {
  it('is a slider named by label with value attributes and defaults', () => {
    renderWithKit(<Controlled />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    expect(slider).toHaveAttribute('aria-valuetext', '50');
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('arrows step by step, clamped to the range', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} step={5} initial={95} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('slider'));
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(100);
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledTimes(1);
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(95);
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(90);
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(95);
  });

  it('Home and End jump to min and max', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} min={10} max={20} initial={15} />);
    await user.tab();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(10);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(20);
  });

  it('formatValue gives aria-valuetext and the visible value', () => {
    renderWithKit(<Controlled initial={12} formatValue={(v) => `${v} dB`} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '12 dB');
    expect(screen.getByText('12 dB')).toBeInTheDocument();
  });

  it('disabled blocks the keyboard', async () => {
    const onChange = vi.fn();
    renderWithKit(<Controlled onChange={onChange} disabled />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const slider = screen.getByRole('slider');
    expect(slider).toBeDisabled();
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is controlled: a parent that ignores onChange keeps the old value', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Slider label="V" value={40} onChange={onChange} />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(41);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('slider')).toHaveValue('40');
  });

  it('labelHidden keeps the accessible name', () => {
    renderWithKit(<Controlled labelHidden />);
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
  });

  it('forwards id', () => {
    renderWithKit(<Controlled id="vol" />);
    expect(screen.getByRole('slider')).toHaveAttribute('id', 'vol');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Slider label="V" value={1} onChange={() => {}} className="x" />,
    );
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('draws the unfilled rail in hairline, not fill, and the filled part in accent', () => {
    renderWithKit(<Controlled />, { base: '#8E75FF', mode: 'dark', intensity: 'minimal' });
    const palette = derivePalette('#8E75FF', 'dark', 'minimal');
    const css = Array.from(document.querySelectorAll('style'))
      .map((node) => node.textContent ?? '')
      .join('\n')
      .toLowerCase();
    const rail = css.split('}').find((rule) => rule.includes('slider-runnable-track')) ?? '';
    expect(rail).toContain(palette.hairline.toLowerCase());
    expect(rail).toContain(palette.accent.toLowerCase());
    expect(rail).not.toContain(palette.fill.toLowerCase());
  });
});
