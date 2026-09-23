import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { ThreadMessageInput } from '../../components/Thread/ThreadMessageInput';

/**
 * On touch layouts the thread composer mirrors the main composer: the extra
 * action (emoji) sits left of the field, and the send button only appears
 * once there's something to send. Desktop keeps emoji + send on the right.
 */

const touch = { isTouchDevice: true, shouldUseTouchUI: true, isMobile: true, isTablet: false, isDesktop: false, deviceType: 'phone' };
const desktop = { isTouchDevice: false, shouldUseTouchUI: false, isMobile: false, isTablet: false, isDesktop: true, deviceType: 'desktop' };
const mockResponsive = vi.fn(() => desktop);

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => mockResponsive(),
}));

const setup = () => {
  const utils = renderWithProviders(<ThreadMessageInput parentMessageId="msg-1" />);
  const input = screen.getByPlaceholderText('Reply...');
  return { ...utils, input };
};

describe('ThreadMessageInput layout', () => {
  beforeEach(() => {
    mockResponsive.mockReset();
    mockResponsive.mockReturnValue(desktop);
  });

  it('desktop: emoji after the field and an always-visible (disabled) send button', () => {
    const { input } = setup();
    const emoji = screen.getByLabelText('add emoji');
    expect(input.compareDocumentPosition(emoji) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('send')).toBeDisabled();
  });

  it('touch: emoji sits before the field and send only appears with text', async () => {
    mockResponsive.mockReturnValue(touch);
    const { input, user } = setup();

    const emoji = screen.getByLabelText('add emoji');
    expect(input.compareDocumentPosition(emoji) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.queryByLabelText('send')).not.toBeInTheDocument();

    await user.type(input, 'hi');
    expect(screen.getByLabelText('send')).toBeEnabled();
  });
});
