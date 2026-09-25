import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useThreadPanel } from '../../contexts/ThreadPanelContext';
import { ThreadPanelProvider } from '../../contexts/ThreadPanelProvider';

function TestConsumer() {
  const { openThreadId, openThread, closeThread } = useThreadPanel();
  return (
    <div>
      <span data-testid="thread-id">{openThreadId ?? 'none'}</span>
      <button onClick={() => openThread('thread-123')}>Open Thread</button>
      <button onClick={closeThread}>Close Thread</button>
    </div>
  );
}

describe('ThreadPanelContext', () => {
  it('openThread(id) sets openThreadId', async () => {
    const user = userEvent.setup();
    render(
      <ThreadPanelProvider>
        <TestConsumer />
      </ThreadPanelProvider>,
    );

    expect(screen.getByTestId('thread-id')).toHaveTextContent('none');

    await user.click(screen.getByText('Open Thread'));

    expect(screen.getByTestId('thread-id')).toHaveTextContent('thread-123');
  });

  it('closeThread() sets openThreadId to null', async () => {
    const user = userEvent.setup();
    render(
      <ThreadPanelProvider>
        <TestConsumer />
      </ThreadPanelProvider>,
    );

    // Open first
    await user.click(screen.getByText('Open Thread'));
    expect(screen.getByTestId('thread-id')).toHaveTextContent('thread-123');

    // Close
    await user.click(screen.getByText('Close Thread'));
    expect(screen.getByTestId('thread-id')).toHaveTextContent('none');
  });

  it('throws when useThreadPanel is used outside provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<TestConsumer />)).toThrow(
      'useThreadPanel must be used within a ThreadPanelProvider',
    );

    consoleSpy.mockRestore();
  });
});
