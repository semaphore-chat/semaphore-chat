import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { renderInEveryTheme } from '../test-utils/themeMatrix';
import { createTestQueryClient } from '../test-utils/queryClient';
import { createTestWrapper } from '../test-utils/wrappers';
import ReplyComposerBanner, { replySnippet } from '../../components/Message/ReplyComposerBanner';
import { createMessage, createSpan } from '../test-utils/factories';
import { SpanType } from '../../types/message.type';

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

describe('ReplyComposerBanner', () => {
  it('shows a one-line snippet of the quoted message', () => {
    const message = createMessage({
      spans: [createSpan({ text: 'So here is the full write-up of what happened' })],
    });
    renderWithProviders(<ReplyComposerBanner replyToMessage={message} onCancel={vi.fn()} />);

    const snippet = screen.getByTestId('reply-banner-snippet');
    expect(snippet).toHaveTextContent('So here is the full write-up of what happened');
    // Single line, truncated with an ellipsis by CSS.
    expect(snippet).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
  });

  it('cancels from the close button', async () => {
    const onCancel = vi.fn();
    const { user } = renderWithProviders(
      <ReplyComposerBanner replyToMessage={createMessage({ spans: [createSpan({ text: 'x' })] })} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole('button', { name: /cancel reply/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders in every theme', () => {
    const Wrapper = createTestWrapper({ queryClient: createTestQueryClient() });
    renderInEveryTheme(
      () => (
        <Wrapper>
          <ReplyComposerBanner replyToMessage={createMessage({ spans: [createSpan({ text: 'hey' })] })} onCancel={vi.fn()} />
        </Wrapper>
      ),
      (result) => {
        expect(result.getByTestId('reply-banner-snippet')).toHaveTextContent('hey');
      },
    );
  });
});

describe('replySnippet', () => {
  it('joins spans and collapses whitespace and newlines', () => {
    const message = createMessage({
      spans: [
        createSpan({ text: 'line one\n\nline' }),
        createSpan({ type: SpanType.USER_MENTION, text: '@Ava' }),
        createSpan({ text: '  two ' }),
      ],
    });
    expect(replySnippet(message)).toBe('line one line @Ava two');
  });

  it('falls back to "Attachment" for a file-only message', () => {
    const message = createMessage({
      spans: [],
      attachments: [{ id: 'f1' } as never],
    });
    expect(replySnippet(message)).toBe('Attachment');
  });

  it('falls back to "Message" when there is nothing to show', () => {
    expect(replySnippet(createMessage({ spans: [] }))).toBe('Message');
  });
});
