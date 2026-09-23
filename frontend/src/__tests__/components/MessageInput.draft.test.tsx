/**
 * MessageInput keeps an unsent draft per channel / DM (mobile UX overhaul,
 * task 13): remounting the composer for the same context restores the text,
 * and sending clears it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

vi.mock('../../components/Message/EmojiPicker', () => ({
  EmojiPickerPopover: () => null,
}));

vi.mock('../../components/Message/GifPicker', () => ({
  GifPickerPopover: () => null,
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    isTouchDevice: false,
    shouldUseTouchUI: false,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    deviceType: 'desktop',
  }),
}));

function composer(contextId: string, onSendMessage = vi.fn()) {
  return (
    <MessageInput
      contextType={VoiceSessionType.Dm}
      contextId={contextId}
      userMentions={[]}
      onSendMessage={onSendMessage}
    />
  );
}

const input = () => screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;

describe('MessageInput — drafts', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('restores the draft after unmount and remount for the same conversation', async () => {
    const first = renderWithProviders(composer('dm-1'));
    await first.user.type(input(), 'not sent yet');
    first.unmount();

    renderWithProviders(composer('dm-1'));
    expect(input()).toHaveValue('not sent yet');
  });

  it('does not leak a draft into another conversation', async () => {
    const first = renderWithProviders(composer('dm-1'));
    await first.user.type(input(), 'for dm-1 only');
    first.unmount();

    renderWithProviders(composer('dm-2'));
    expect(input()).toHaveValue('');
  });

  it('swaps drafts when the same composer switches conversation', async () => {
    const { user, rerender } = renderWithProviders(composer('dm-1'));
    await user.type(input(), 'first');
    rerender(composer('dm-2'));
    expect(input()).toHaveValue('');
    rerender(composer('dm-1'));
    expect(input()).toHaveValue('first');
  });

  it('clears the draft after sending', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const first = renderWithProviders(composer('dm-1', onSend));
    await first.user.type(input(), 'ship it{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input()).toHaveValue(''));
    first.unmount();

    renderWithProviders(composer('dm-1'));
    expect(input()).toHaveValue('');
  });
});
