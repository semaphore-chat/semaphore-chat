import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, runAxe, expectNoAxeViolations } from '../test-utils';
import MessageInput from '../../components/Message/MessageInput';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import type { UserMention } from '../../utils/mentionParser';

// Let MSW intercept API-client requests
vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

// MentionDropdown renders UserAvatar for user-type suggestions, which needs
// a FileCacheProvider renderWithProviders doesn't set up. Stub it out.
vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

// Mock the emoji picker so we can trigger a selection deterministically.
// When open, it renders a button that inserts a fixed emoji.
vi.mock('../../components/Message/EmojiPicker', () => ({
  EmojiPickerPopover: ({
    open,
    onEmojiSelect,
  }: {
    open: boolean;
    onEmojiSelect: (emoji: string) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="mock-emoji-pick"
        onClick={() => onEmojiSelect('🎉')}
      >
        pick
      </button>
    ) : null,
}));

// Mock the GIF picker so we can trigger a selection deterministically.
vi.mock('../../components/Message/GifPicker', () => ({
  GifPickerPopover: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (gif: { id: string; url: string; previewUrl: string; title: string; width: number; height: number }) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="mock-gif-pick"
        onClick={() =>
          onSelect({
            id: 'gif-1',
            url: 'https://media.tenor.com/1/cat.gif',
            previewUrl: 'https://media.tenor.com/1/cat-tiny.gif',
            title: 'Cat',
            width: 220,
            height: 140,
          })
        }
      >
        pick gif
      </button>
    ) : null,
}));

// Controls the public-settings `gifSearchEnabled` flag consumed by MessageInput.
// Reset to false in beforeEach; individual tests flip it on.
let mockGifSearchEnabled = false;

vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    instanceControllerGetPublicSettingsOptions: () => ({
      queryKey: ['instanceControllerGetPublicSettings'],
      queryFn: () =>
        Promise.resolve({
          name: 'Test Instance',
          registrationMode: 'OPEN',
          maxFileSizeBytes: 500 * 1024 * 1024,
          gifSearchEnabled: mockGifSearchEnabled,
        }),
    }),
  };
});

// Default: desktop (non-touch). Individual tests override isTouchDevice.
const mockResponsive = vi.fn(() => ({
  isTouchDevice: false,
  shouldUseTouchUI: false,
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  deviceType: 'desktop' as string,
}));

vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => mockResponsive(),
}));

function setup(onSendMessage = vi.fn(), userMentions: UserMention[] = []) {
  const utils = renderWithProviders(
    <MessageInput
      contextType={VoiceSessionType.Dm}
      contextId="dm-1"
      userMentions={userMentions}
      onSendMessage={onSendMessage}
    />,
  );
  const input = screen.getByPlaceholderText(
    'Type a message...',
  ) as HTMLTextAreaElement;
  return { ...utils, input, onSendMessage };
}

const MENTION_MEMBERS: UserMention[] = [
  { id: 'u-alice', username: 'alice', displayName: 'Alice' },
  { id: 'u-alan', username: 'alan', displayName: 'Alan' },
];

describe('MessageInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks does not reset mockReturnValue/implementation
    mockResponsive.mockReturnValue({
      isTouchDevice: false,
      shouldUseTouchUI: false,
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      deviceType: 'desktop',
    });
    mockGifSearchEnabled = false;
  });

  describe('emoji insertion', () => {
    it('inserts the selected emoji at the current cursor position', async () => {
      const { user, input } = setup();

      await user.type(input, 'Hello');
      // Place the caret between "He" and "llo"
      input.setSelectionRange(2, 2);
      fireEvent.select(input);

      // Open the (mocked) picker and select an emoji
      await user.click(screen.getByLabelText('add emoji'));
      await user.click(screen.getByTestId('mock-emoji-pick'));

      expect(input.value).toBe('He🎉llo');

      // Caret should land immediately after the inserted emoji ("🎉".length === 2)
      await waitFor(() => {
        expect(input.selectionStart).toBe(4);
      });
    });

    it('appends the emoji when the caret is at the end', async () => {
      const { user, input } = setup();

      await user.type(input, 'Hi');
      // caret already at end (2)
      await user.click(screen.getByLabelText('add emoji'));
      await user.click(screen.getByTestId('mock-emoji-pick'));

      expect(input.value).toBe('Hi🎉');
    });
  });

  describe('Enter key behavior', () => {
    it('sends on Enter on desktop', async () => {
      const { user, input, onSendMessage } = setup();

      await user.type(input, 'hi{Enter}');

      await waitFor(() => {
        expect(onSendMessage).toHaveBeenCalledTimes(1);
      });
      expect(onSendMessage).toHaveBeenCalledWith(
        'hi',
        expect.any(Array),
        expect.any(Array),
      );
      // Newline should NOT have been inserted (send prevented default)
      expect(input.value).toBe('');
    });

    it('inserts a newline (does not send) on Enter on touch devices', async () => {
      mockResponsive.mockReturnValue({
        isTouchDevice: true,
        shouldUseTouchUI: true,
        isMobile: true,
        isTablet: false,
        isDesktop: false,
        deviceType: 'phone',
      });

      const { user, input, onSendMessage } = setup();

      await user.type(input, 'hi{Enter}');

      expect(onSendMessage).not.toHaveBeenCalled();
      expect(input.value).toBe('hi\n');
    });
  });

  describe('GIF picker', () => {
    it('hides the GIF button when gifSearchEnabled is false', async () => {
      mockGifSearchEnabled = false;
      setup();

      await waitFor(() => {
        expect(screen.queryByLabelText('add gif')).not.toBeInTheDocument();
      });
    });

    it('shows the GIF button when gifSearchEnabled is true', async () => {
      mockGifSearchEnabled = true;
      setup();

      expect(await screen.findByLabelText('add gif')).toBeInTheDocument();
    });

    it('sends the GIF url immediately on selection, leaving composer text untouched', async () => {
      mockGifSearchEnabled = true;
      const { user, input, onSendMessage } = setup();

      await user.type(input, 'still typing');
      await user.click(await screen.findByLabelText('add gif'));
      await user.click(screen.getByTestId('mock-gif-pick'));

      await waitFor(() => {
        expect(onSendMessage).toHaveBeenCalledTimes(1);
      });
      expect(onSendMessage).toHaveBeenCalledWith(
        'https://media.tenor.com/1/cat.gif',
        expect.any(Array),
        [],
      );
      // The composer's own draft text is untouched by the GIF send.
      expect(input.value).toBe('still typing');
    });
  });

  describe('mention autocomplete (combobox pattern)', () => {
    it('marks the input as a combobox wired to the listbox, with aria-activedescendant tracking the highlighted option', async () => {
      const { user, input } = setup(vi.fn(), MENTION_MEMBERS);

      expect(input).toHaveAttribute('aria-autocomplete', 'list');
      expect(input).not.toHaveAttribute('aria-controls');
      expect(input).not.toHaveAttribute('aria-activedescendant');

      await user.type(input, '@a');

      const listbox = await screen.findByRole('listbox', { name: /mention suggestions/i });
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThanOrEqual(2);

      expect(input).toHaveAttribute('aria-controls', listbox.id);
      expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      expect(options[1]).toHaveAttribute('aria-selected', 'false');
    });

    it('ArrowDown moves the highlighted option and updates aria-activedescendant to match', async () => {
      const { user, input } = setup(vi.fn(), MENTION_MEMBERS);

      await user.type(input, '@a');
      const options = await screen.findAllByRole('option');
      expect(input).toHaveAttribute('aria-activedescendant', options[0].id);

      await user.keyboard('{ArrowDown}');

      expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
    });

    it('Enter selects the highlighted suggestion and closes the listbox, keeping focus on the input', async () => {
      const { user, input } = setup(vi.fn(), MENTION_MEMBERS);

      await user.type(input, '@a');
      await screen.findAllByRole('option');
      // Move to the second suggestion (alan) before committing.
      await user.keyboard('{ArrowDown}{Enter}');

      expect(input.value).toContain('@Alan');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(input).not.toHaveAttribute('aria-controls');
      expect(input).not.toHaveAttribute('aria-activedescendant');
      // The combobox pattern keeps focus on the input throughout — there is
      // no separate menu to invoke/restore focus from.
      expect(document.activeElement).toBe(input);
    });

    it('Escape closes the listbox without inserting a mention, and focus stays on the input', async () => {
      const { user, input } = setup(vi.fn(), MENTION_MEMBERS);

      await user.type(input, '@a');
      await screen.findAllByRole('option');

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(input).not.toHaveAttribute('aria-controls');
      expect(input.value).toBe('@a');
      expect(document.activeElement).toBe(input);
    });

    it('has no axe violations while the mention dropdown is open', async () => {
      const { user, input, container } = setup(vi.fn(), MENTION_MEMBERS);

      await user.type(input, '@a');
      await screen.findByRole('listbox');

      const results = await runAxe(container);
      expectNoAxeViolations(results);
    });
  });

  describe('draft height cap', () => {
    // jsdom has no layout, so assert the emotion-generated rule itself.
    const cssText = () =>
      Array.from(document.querySelectorAll('style'))
        .map((el) => el.textContent ?? '')
        .join('\n');

    it('caps the draft at 40% of the chat column height, then scrolls', () => {
      setup();
      expect(cssText()).toMatch(/max-height:\s*calc\(var\(--chat-column-height,\s*100vh\)\s*\*\s*0\.4\)/);
      expect(cssText()).toMatch(/overflow-y:\s*auto\s*!important/);
    });

    it('drops the fixed 4-row cap on desktop (the 40% cap applies instead)', () => {
      const { input } = setup();
      const long = 'line\n'.repeat(12);
      fireEvent.change(input, { target: { value: long } });
      // MUI's autosize writes an inline max-height only when maxRows is set.
      expect(input.style.maxHeight).toBe('');
    });
  });
});
