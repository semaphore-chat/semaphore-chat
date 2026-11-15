import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, tabElementId, type TabItem } from '../../kit';
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
    // Focusing a tab is a step of the list host (focusIn), so it updates state: inside act.
    act(() => screen.getByRole('tab', { name: 'All' }).focus());

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

  it('after the user left the tabs, a value changed from outside is where Tab comes back', async () => {
    const ui = (value: string) => (
      <>
        <Tabs label="Notify" tabs={TABS} value={value} onChange={() => {}} />
        <button type="button">After</button>
      </>
    );
    const { user, rerender } = renderWithKit(ui('all'));
    act(() => screen.getByRole('tab', { name: 'All' }).focus());
    await user.keyboard('{ArrowRight}');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
    rerender(ui('none'));
    expect(screen.getByRole('tab', { name: 'Nothing' })).toHaveAttribute('tabindex', '0');
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Nothing' }));
  });

  it('Up and Down move between tabs too', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    act(() => screen.getByRole('tab', { name: 'All' }).focus());
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('mentions');
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('all');
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

  it('names a tab with a count "<label>, <count>"', () => {
    renderWithKit(<Controlled />);
    expect(screen.getByRole('tab', { name: 'Mentions, 3' })).toBeInTheDocument();
  });

  it('a value that names no tab leaves the first enabled tab reachable', () => {
    renderWithKit(<Tabs label="X" tabs={TABS} value="missing" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('tabindex', '0');
  });

  it('a value that names a disabled tab leaves the first enabled tab reachable', () => {
    renderWithKit(<Tabs label="X" tabs={TABS} value="off" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Muted' })).toHaveAttribute('tabindex', '-1');
  });

  it('clicking the already-selected tab does not call onChange', async () => {
    const onChange = vi.fn();
    const { user } = renderWithKit(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'All' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives every tab an id from the list id and tab id, and aria-controls from panelId', () => {
    const tabs: TabItem[] = [
      { id: 'all', label: 'All', panelId: 'panel-all' },
      { id: 'mentions', label: 'Mentions' },
    ];
    renderWithKit(<Tabs label="X" id="nav" tabs={tabs} value="all" onChange={() => {}} />);
    const all = screen.getByRole('tab', { name: 'All' });
    expect(all).toHaveAttribute('id', tabElementId('nav', 'all'));
    expect(all).toHaveAttribute('id', 'nav-tab-all');
    expect(all).toHaveAttribute('aria-controls', 'panel-all');
    expect(screen.getByRole('tab', { name: 'Mentions' })).not.toHaveAttribute('aria-controls');
  });

  it('a panel labelled by the tab id gets the tab as its name', () => {
    renderWithKit(
      <>
        <Tabs label="X" id="nav" tabs={[{ id: 'all', label: 'All', panelId: 'p' }]} value="all" onChange={() => {}} />
        <div role="tabpanel" id="p" aria-labelledby={tabElementId('nav', 'all')} />
      </>,
    );
    expect(screen.getByRole('tabpanel', { name: 'All' })).toBeInTheDocument();
  });

  it('generates unique tab ids when no id is passed', () => {
    renderWithKit(
      <>
        <Tabs label="A" tabs={[{ id: 'x', label: 'One' }]} value="x" onChange={() => {}} />
        <Tabs label="B" tabs={[{ id: 'x', label: 'Two' }]} value="x" onChange={() => {}} />
      </>,
    );
    const ids = screen.getAllByRole('tab').map((tab) => tab.getAttribute('id'));
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  describe('scrolling the selected tab into view', () => {
    // jsdom has no layout: fake a 100px-wide list of five 60px tabs.
    const scrolled = new WeakMap<Element, number>();
    const restore: Array<() => void> = [];
    const define = (name: string, descriptor: PropertyDescriptor) => {
      const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, ...descriptor });
      restore.push(() => {
        if (original) {
          Object.defineProperty(HTMLElement.prototype, name, original);
        } else {
          delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
        }
      });
    };
    beforeEach(() => {
      define('clientWidth', { get: () => 100 });
      define('offsetWidth', { get: () => 60 });
      define('offsetLeft', {
        get(this: HTMLElement) {
          const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
          return index * 60;
        },
      });
      define('scrollLeft', {
        get(this: HTMLElement) {
          return scrolled.get(this) ?? 0;
        },
        set(this: HTMLElement, value: number) {
          scrolled.set(this, value);
        },
      });
    });
    afterEach(() => {
      restore.splice(0).reverse().forEach((undo) => undo());
    });

    const FIVE: TabItem[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() }));

    it('on mount, when the initial value is off-screen', () => {
      renderWithKit(<Tabs label="X" tabs={FIVE} value="e" onChange={() => {}} />);
      // Tab e spans 240..300; the list shows 100px, so it scrolls to 200.
      expect(screen.getByRole('tablist').scrollLeft).toBe(200);
    });

    it('when value changes from outside, in both directions', () => {
      const { rerender } = renderWithKit(<Tabs label="X" tabs={FIVE} value="a" onChange={() => {}} />);
      expect(screen.getByRole('tablist').scrollLeft).toBe(0);
      rerender(<Tabs label="X" tabs={FIVE} value="d" onChange={() => {}} />);
      expect(screen.getByRole('tablist').scrollLeft).toBe(140);
      rerender(<Tabs label="X" tabs={FIVE} value="a" onChange={() => {}} />);
      expect(screen.getByRole('tablist').scrollLeft).toBe(0);
    });
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
