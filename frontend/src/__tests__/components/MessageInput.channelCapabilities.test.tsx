/**
 * Composer states driven by the channel capabilities: read-only notice copy
 * and attachments turned off (button, touch sheet, paste).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import MessageInput, { ComposerUnavailableNotice } from '../../components/Message/MessageInput';
import { formatRoleList } from '../../utils/formatRoleList';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import type { ComposerAvailability } from '../../hooks/useComposerAvailability';

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

const mockAvailability = vi.fn<() => ComposerAvailability>(() => ({ state: 'ok' }));
vi.mock('../../hooks/useComposerAvailability', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useComposerAvailability: () => mockAvailability(),
}));

const DESKTOP = {
  isTouchDevice: false,
  shouldUseTouchUI: false,
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  deviceType: 'desktop' as string,
};
const TOUCH = { ...DESKTOP, isTouchDevice: true, shouldUseTouchUI: true, isMobile: true, isDesktop: false, deviceType: 'phone' };
const mockResponsive = vi.fn(() => DESKTOP);
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => mockResponsive(),
}));

function renderInput() {
  return renderWithProviders(
    <MessageInput
      contextType={VoiceSessionType.Channel}
      contextId="channel-1"
      communityId="community-1"
      userMentions={[]}
      onSendMessage={vi.fn()}
    />,
  );
}

const NO_ATTACH: ComposerAvailability = { state: 'ok', channelName: 'general', canAttach: false };

describe('MessageInput channel capabilities', () => {
  beforeEach(() => {
    mockAvailability.mockReset();
    mockAvailability.mockReturnValue({ state: 'ok' });
    mockResponsive.mockReturnValue(DESKTOP);
  });

  describe('read-only notice', () => {
    it('names the channel and who can post', () => {
      mockAvailability.mockReturnValue({
        state: 'read-only',
        channelName: 'announcements',
        postingRoleNames: ['Moderator', 'Community Admin'],
      });
      renderInput();
      expect(screen.getByRole('status')).toHaveTextContent(
        '#announcements is read-only. Only Moderator and Community Admin can post.',
      );
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('drops the role list when no role can post', () => {
      renderWithProviders(
        <ComposerUnavailableNotice availability={{ state: 'read-only', channelName: 'rules' }} />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('#rules is read-only.');
      expect(screen.getByRole('status')).not.toHaveTextContent('Only');
    });

    it('falls back to "This channel" without a name', () => {
      renderWithProviders(
        <ComposerUnavailableNotice availability={{ state: 'read-only', postingRoleNames: ['Admin'] }} />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('This channel is read-only. Only Admin can post.');
    });

    it.each([
      [[], ''],
      [['Admin'], 'Admin'],
      [['Moderator', 'Admin'], 'Moderator and Admin'],
      [['A', 'B', 'C'], 'A, B and C'],
    ])('formatRoleList(%j) = %j', (names, expected) => {
      expect(formatRoleList(names)).toBe(expected);
    });
  });

  describe('attachments turned off', () => {
    it('keeps the composer but disables the attach button, with a tooltip', async () => {
      mockAvailability.mockReturnValue(NO_ATTACH);
      const { user } = renderInput();
      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
      const attach = screen.getByRole('button', { name: /attach file/i });
      expect(attach).toBeDisabled();
      await user.hover(attach.parentElement!);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Attaching files is turned off in #general',
      );
    });

    it('the attach button is enabled when attaching is allowed', () => {
      mockAvailability.mockReturnValue({ state: 'ok', channelName: 'general', canAttach: true });
      renderInput();
      expect(screen.getByRole('button', { name: /attach file/i })).toBeEnabled();
    });

    it('disables "Attach file" in the touch sheet and says why', async () => {
      mockResponsive.mockReturnValue(TOUCH);
      mockAvailability.mockReturnValue(NO_ATTACH);
      const { user } = renderInput();
      await user.click(screen.getByRole('button', { name: /add attachment, gif or emoji/i }));
      const sheet = await screen.findByTestId('composer-actions-sheet');
      const item = within(sheet).getByRole('button', { name: /attach file/i });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveTextContent('Attaching files is turned off in #general');
    });

    it('ignores a pasted file and shows a warning', async () => {
      mockAvailability.mockReturnValue(NO_ATTACH);
      renderInput();
      const file = new File(['x'], 'photo.png', { type: 'image/png' });
      fireEvent.paste(screen.getByPlaceholderText('Type a message...'), {
        clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] },
      });
      expect(await screen.findByText('Attaching files is turned off in #general')).toBeInTheDocument();
      expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
    });

    it('accepts a pasted file when attaching is allowed', async () => {
      mockAvailability.mockReturnValue({ state: 'ok', channelName: 'general', canAttach: true });
      renderInput();
      const file = new File(['x'], 'photo.png', { type: 'image/png' });
      fireEvent.paste(screen.getByPlaceholderText('Type a message...'), {
        clipboardData: { items: [{ kind: 'file', getAsFile: () => file }] },
      });
      expect(await screen.findByText('photo.png')).toBeInTheDocument();
    });
  });
});
