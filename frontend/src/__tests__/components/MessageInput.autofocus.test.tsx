/**
 * The composer focuses itself on mount. It must do so without scrolling any
 * ancestor: on phone the chat screen is still sliding in (translated off to
 * the right) when it mounts, and a scrolling focus() scrolls the
 * overflow-hidden screen container sideways, leaving the chat shifted left
 * after the slide ends (seen opening a DM whose request is slow).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageInput from '../../components/Message/MessageInput';
import { VoiceSessionType } from '../../contexts/VoiceContext';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

vi.mock('../../hooks/useComposerAvailability', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useComposerAvailability: () => ({ state: 'ok' }),
}));

describe('MessageInput autofocus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('focuses the composer on mount without scrolling its ancestors', () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');

    renderWithProviders(
      <MessageInput
        contextType={VoiceSessionType.Dm}
        contextId="dm-1"
        userMentions={[]}
        onSendMessage={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
