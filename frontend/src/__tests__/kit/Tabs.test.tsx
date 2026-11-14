import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, type TabItem } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

const TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions', count: 3 },
  { id: 'off', label: 'Muted', disabled: true },
  { id: 'none', label: 'Nothing' },
];

function Controlled({ onChange = () => {}, variant }: { onChange?: (id: string) => void; variant?: 'underline' | 'segmented' }) {
  const [value, setValue] = useState('all');
  return (
    <Tabs
      label="Notify"
      tabs={TABS}
      value={value}
      variant={variant}
      onChange={(id) => {
        onChange(id);
        setValue(id);
      }}
    />
  );
}

describe('Tabs', () => {
  it.each(['underline', 'segmented'] as const)('%s: tablist with aria-selected tabs', (variant) => {
    renderWithKit(<Controlled variant={variant} />);
    expect(screen.getByRole('tablist', { name: 'Notify' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Mentions/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the id on click', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: /Mentions/ }));
    expect(onChange).toHaveBeenCalledWith('mentions');
    expect(screen.getByRole('tab', { name: /Mentions/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('only the selected tab is in the tab order', () => {
    renderWithKit(<Controlled />);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Mentions/ })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Nothing' })).toHaveAttribute('tabindex', '-1');
  });

  it('arrows, Home and End move focus and selection, skipping disabled tabs and wrapping', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    screen.getByRole('tab', { name: 'All' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Mentions/ }));
    expect(onChange).toHaveBeenLastCalledWith('mentions');

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Nothing' }));
    expect(onChange).toHaveBeenLastCalledWith('none');

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'All' }));

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Nothing' }));

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'All' }));
    expect(onChange).toHaveBeenLastCalledWith('all');

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Nothing' }));
    expect(onChange).toHaveBeenLastCalledWith('none');
  });

  it('a disabled tab is disabled and ignores clicks', async () => {
    const onChange = vi.fn();
    renderWithKit(<Controlled onChange={onChange} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const muted = screen.getByRole('tab', { name: 'Muted' });
    expect(muted).toBeDisabled();
    await user.click(muted);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the count after the label', () => {
    renderWithKit(<Controlled />);
    const tab = screen.getByRole('tab', { name: /Mentions/ });
    expect(tab).toHaveTextContent('Mentions3');
  });

  it('shows the value in the tab order even when it names a disabled tab only if present', () => {
    renderWithKit(<Tabs label="X" tabs={TABS} value="missing" onChange={() => {}} />);
    // No selected tab: the first enabled tab stays reachable.
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('tabindex', '0');
  });

  it('accepts fullWidth and id', () => {
    renderWithKit(<Tabs label="X" id="t" tabs={TABS} value="all" onChange={() => {}} fullWidth />);
    expect(screen.getByRole('tablist')).toHaveAttribute('id', 't');
  });

  it('does not accept className', () => {
    renderWithKit(
      // @ts-expect-error -- closed props.
      <Tabs label="X" tabs={TABS} value="all" onChange={() => {}} className="x" />,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
