/**
 * Slimmer composer on touch layouts (mobile UX overhaul, task 11): one "+"
 * button opens a sheet with Attach / GIF / Emoji, and the send button only
 * appears once there is something to send. Desktop keeps the inline buttons.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import MessageInput from '../../components/Message/MessageInput';
import { VoiceSessionType } from '../../contexts/VoiceContext';
import { createTestQueryClient } from '../test-utils/queryClient';
import { createTestWrapper } from '../test-utils/wrappers';
import { NotificationProvider } from '../../contexts/NotificationContext';
import { MemoryRouter } from 'react-router-dom';

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
  EmojiPickerPopover: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mock-emoji-picker" /> : null,
}));

vi.mock('../../components/Message/GifPicker', () => ({
  GifPickerPopover: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mock-gif-picker" /> : null,
}));

let mockGifSearchEnabled = true;
vi.mock('../../api-client/@tanstack/react-query.gen', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    instanceControllerGetPublicSettingsOptions: () => ({
      queryKey: ['instanceControllerGetPublicSettings', mockGifSearchEnabled],
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

const TOUCH = {
  isTouchDevice: true,
  shouldUseTouchUI: true,
  isMobile: true,
  isTablet: false,
  isDesktop: false,
  deviceType: 'phone' as string,
};
const DESKTOP = {
  isTouchDevice: false,
  shouldUseTouchUI: false,
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  deviceType: 'desktop' as string,
};
const mockResponsive = vi.fn(() => TOUCH);
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => mockResponsive(),
}));

function composer() {
  return (
    <MessageInput
      contextType={VoiceSessionType.Dm}
      contextId="dm-1"
      userMentions={[]}
      onSendMessage={vi.fn()}
    />
  );
}

function setup() {
  const utils = renderWithProviders(composer());
  const input = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
  return { ...utils, input };
}

describe('MessageInput — touch composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponsive.mockReturnValue(TOUCH);
    mockGifSearchEnabled = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a single "+" button instead of inline attach / GIF / emoji buttons', async () => {
    setup();
    expect(screen.getByRole('button', { name: /add attachment, gif or emoji/i })).toBeInTheDocument();
    // Give the public-settings query a chance to resolve (GIF flag on).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'add gif' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'attach file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'add emoji' })).not.toBeInTheDocument();
  });

  it('opens a sheet with Attach, GIF and Emoji from the "+" button', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /add attachment, gif or emoji/i }));

    const sheet = await screen.findByTestId('composer-actions-sheet');
    expect(within(sheet).getByRole('button', { name: /attach file/i })).toBeInTheDocument();
    expect(await within(sheet).findByRole('button', { name: /gif/i })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /emoji/i })).toBeInTheDocument();
  });

  it('omits GIF from the sheet when GIF search is disabled', async () => {
    mockGifSearchEnabled = false;
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /add attachment, gif or emoji/i }));
    const sheet = await screen.findByTestId('composer-actions-sheet');
    // Wait for the settings query, then assert no GIF row.
    await waitFor(() => {
      expect(within(sheet).queryByRole('button', { name: /gif/i })).not.toBeInTheDocument();
    });
  });

  it('"Attach file" in the sheet triggers the hidden file input', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /add attachment, gif or emoji/i }));
    const sheet = await screen.findByTestId('composer-actions-sheet');
    await user.click(within(sheet).getByRole('button', { name: /attach file/i }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const clicked = clickSpy.mock.contexts[0] as HTMLInputElement;
    expect(clicked.type).toBe('file');
  });

  it('"Emoji" in the sheet opens the emoji picker', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /add attachment, gif or emoji/i }));
    const sheet = await screen.findByTestId('composer-actions-sheet');
    await user.click(within(sheet).getByRole('button', { name: /emoji/i }));
    expect(await screen.findByTestId('mock-emoji-picker')).toBeInTheDocument();
  });

  it('"GIF" in the sheet opens the GIF picker', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /add attachment, gif or emoji/i }));
    const sheet = await screen.findByTestId('composer-actions-sheet');
    await user.click(await within(sheet).findByRole('button', { name: /gif/i }));
    expect(await screen.findByTestId('mock-gif-picker')).toBeInTheDocument();
  });

  it('hides send when the draft is empty and shows it once there is text', async () => {
    const { user, input } = setup();
    expect(screen.queryByRole('button', { name: 'send' })).not.toBeInTheDocument();

    await user.type(input, 'hi');
    expect(screen.getByRole('button', { name: 'send' })).toBeEnabled();

    await user.clear(input);
    expect(screen.queryByRole('button', { name: 'send' })).not.toBeInTheDocument();
  });

  it('keeps send hidden for whitespace-only drafts', async () => {
    const { user, input } = setup();
    await user.type(input, '   ');
    expect(screen.queryByRole('button', { name: 'send' })).not.toBeInTheDocument();
  });

  it('renders in every theme', () => {
    renderInEveryTheme(
      () => renderWithProvidersElement(),
      ({ getByRole }) => {
        expect(getByRole('button', { name: /add attachment, gif or emoji/i })).toBeInTheDocument();
      },
    );
  });
});

describe('MessageInput — desktop composer unchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponsive.mockReturnValue(DESKTOP);
    mockGifSearchEnabled = true;
  });

  it('keeps inline emoji, GIF and attach buttons and no "+" button', async () => {
    setup();
    expect(screen.getByRole('button', { name: 'add emoji' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'attach file' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'add gif' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add attachment, gif or emoji/i })).not.toBeInTheDocument();
  });

  it('always renders send (disabled while empty)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
  });
});

function renderWithProvidersElement() {
  const Wrapper = createTestWrapper({ queryClient: createTestQueryClient() });
  return (
    <Wrapper>
      <MemoryRouter>
        <NotificationProvider>{composer()}</NotificationProvider>
      </MemoryRouter>
    </Wrapper>
  );
}
