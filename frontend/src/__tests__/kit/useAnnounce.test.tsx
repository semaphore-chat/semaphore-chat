import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAnnounce } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';

const region = (container: HTMLElement, politeness: 'polite' | 'assertive') =>
  container.ownerDocument.querySelector(`[aria-live="${politeness}"]`) as HTMLElement;

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

function Speak({ text, politeness }: { text: string; politeness?: 'polite' | 'assertive' }) {
  const announce = useAnnounce();
  return (
    <button type="button" onClick={() => announce(text, politeness)}>
      say
    </button>
  );
}

describe('useAnnounce (K4)', () => {
  it('is a no-op outside a KitProvider: no throw, no error', () => {
    const { result } = renderHook(() => useAnnounce());
    expect(() => result.current('Hello')).not.toThrow();
    expect(() => result.current('Hello', 'assertive')).not.toThrow();
    render(<Speak text="x" />);
  });

  it('says the text politely by default', async () => {
    const { user, container } = renderWithKit(<Speak text="Squad Up opened" />);
    await user.click(screen.getByRole('button', { name: 'say' }));
    await waitFor(() => expect(region(container, 'polite')).toHaveTextContent('Squad Up opened'));
    expect(region(container, 'assertive')).toBeEmptyDOMElement();
  });

  it('says it assertively when asked', async () => {
    const { user, container } = renderWithKit(<Speak text="Disconnected" politeness="assertive" />);
    await user.click(screen.getByRole('button', { name: 'say' }));
    await waitFor(() => expect(region(container, 'assertive')).toHaveTextContent('Disconnected'));
    expect(region(container, 'polite')).toBeEmptyDOMElement();
  });

  it('returns the same function on every render', () => {
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useAnnounce());
      return null;
    }
    const { rerender } = renderWithKit(<Probe />);
    rerender(<Probe />);
    expect(seen[1]).toBe(seen[0]);
  });
});
