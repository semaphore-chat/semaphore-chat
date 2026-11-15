import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Button, Dialog, KitProvider, Menu } from '../../../../kit';
import { useBehaviourHost } from '../../../../kit/behaviour/hosts/hostContext';
import { renderWithKit } from '../../../test-utils/renderWithKit';

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  vi.useRealTimers();
});

let sayRef: ((text: string, politeness: 'polite' | 'assertive') => void) | null = null;
function Probe() {
  sayRef = useBehaviourHost().announcer.say;
  return null;
}
const say = (text: string, politeness: 'polite' | 'assertive' = 'polite') => {
  act(() => {
    sayRef?.(text, politeness);
    vi.advanceTimersToNextFrame();
  });
};

const regions = () => ({
  polite: Array.from(document.querySelectorAll<HTMLElement>('[aria-live="polite"]')),
  assertive: Array.from(document.querySelectorAll<HTMLElement>('[aria-live="assertive"]')),
});

describe('BehaviourHost', () => {
  it('renders one live-region pair in the body, outside the rendered tree, before any text', () => {
    const { container } = renderWithKit(<Probe />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const { polite, assertive } = regions();
    expect(polite).toHaveLength(1);
    expect(assertive).toHaveLength(1);
    expect(polite[0]).toBeEmptyDOMElement();
    expect(assertive[0]).toBeEmptyDOMElement();
  });

  it('a nested KitProvider reuses the outer host: one pair, one announcer', () => {
    const seen: unknown[] = [];
    function Capture() {
      seen.push(useBehaviourHost());
      return null;
    }
    renderWithKit(
      <>
        <Capture />
        <KitProvider base="#8E75FF" mode="light" intensity="minimal">
          <Capture />
        </KitProvider>
      </>,
    );
    expect(regions().polite).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('sibling KitProviders each own a host', () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <KitProvider base="#8E75FF" mode="dark" intensity="minimal">
          <Probe />
        </KitProvider>
        <KitProvider base="#8E75FF" mode="light" intensity="minimal">
          <Probe />
        </KitProvider>
      </ThemeProvider>,
    );
    expect(regions().polite).toHaveLength(2);
  });

  it('announces into the page root while no modal is open', () => {
    vi.useFakeTimers();
    renderWithKit(<Probe />);
    say('Saved');
    expect(regions().polite[0]).toHaveTextContent('Saved');
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Probe />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete #memes?"
        description="This removes the channel."
        actions={<Button onClick={() => setOpen(false)}>Cancel</Button>}
      />
    </>
  );
}

describe('announcements and modal layers', () => {
  it('an announcement made while a Dialog is open lands inside the dialog, which the page cannot hide', () => {
    vi.useFakeTimers();
    renderWithKit(<DialogHarness />);
    const dialog = screen.getByRole('dialog');
    const root = document.querySelector('[data-kit-live-slot="root"]');
    expect(root).not.toBeNull();
    expect(dialog.closest('.MuiModal-root')).not.toBeNull();
    say('Copied');
    const modalRoot = dialog.closest('.MuiModal-root') as HTMLElement;
    const inside = modalRoot.querySelectorAll('[aria-live="polite"]');
    expect(inside).toHaveLength(1);
    expect(inside[0]).toHaveTextContent('Copied');
    expect(modalRoot.querySelector('[data-kit-live-slot="layer"]')).not.toBeNull();
    // The page root pair is hidden by MUI and stays empty.
    expect(root).toHaveTextContent('');
    expect(root?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(modalRoot.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('after the dialog closes, announcements go back to the page root', () => {
    vi.useFakeTimers();
    renderWithKit(<DialogHarness />);
    act(() => screen.getByRole('button', { name: 'Cancel' }).click());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    say('Done');
    expect(document.querySelector('[data-kit-live-slot="root"]')).toHaveTextContent('Done');
  });

  it('an announcement made while a Menu is open lands inside the menu layer', () => {
    vi.useFakeTimers();
    function MenuHarness() {
      const [anchor] = useState(() => {
        const button = document.createElement('button');
        document.body.append(button);
        return button;
      });
      return (
        <>
          <Probe />
          <Menu open anchor={anchor} onClose={() => {}} label="Actions" items={[{ id: 'a', label: 'Rename', onSelect: () => {} }]} />
        </>
      );
    }
    renderWithKit(<MenuHarness />);
    say('Renamed');
    const menu = screen.getByRole('menu');
    const modalRoot = menu.closest('.MuiModal-root') as HTMLElement;
    expect(modalRoot.querySelector('[aria-live="polite"]')).toHaveTextContent('Renamed');
    expect(document.querySelector('[data-kit-live-slot="root"]')).toHaveTextContent('');
  });
});
