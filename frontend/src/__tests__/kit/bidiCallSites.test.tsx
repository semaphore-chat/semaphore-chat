/**
 * Every place that draws a message's words as a one-line preview drops bidi embeddings, overrides and isolates
 * (the plain marks stay). One assertion per call site.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { renderWithProviders, createDmGroup, createMessage, createSpan } from '../test-utils';
import { renderWithKit } from '../test-utils/renderWithKit';
import { MessageQuote } from '../../kit';
import { segmentsLine } from '../../data/chat/toSegments';
import { toQuoteView } from '../../data/chat/messageRowModel';
import { pinnedText } from '../../data/chat/usePinnedList';
import { replySnippet } from '../../components/Message/ReplyComposerBanner';
import { buildPreviewText } from '../../hooks/useMessageListAnnouncer';
import { getMessagePreview, plainSpanText } from '../../utils/notificationHelpers';
import { spansToText } from '../../utils/mentionParser';
import DmListItem from '../../components/DirectMessages/DmListItem';
import QuotePreview from '../../components/Message/QuotePreview';
import { MessageSearchResultList } from '../../components/Message/MessageSearchResults';
import { UnreadDmList } from '../../components/Home/HomeSections';
import { SpanType } from '../../types/message.type';

const BIDI = /[‪-‮⁦-⁩]/;
const dirty = 'ab‮cd⁦ e‏';
const clean = 'abcd e‏';
const spans = [{ type: SpanType.PLAINTEXT, text: dirty }] as never;

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});
vi.mock('../../components/Common/UserAvatar', () => ({ default: () => <div /> }));

describe('previews drop bidi controls', () => {
  it('segmentsLine', () => {
    expect(segmentsLine([{ type: 'text', text: dirty }])).toBe(clean);
  });
  it('toQuoteView', () => {
    const view = toQuoteView({ id: 'm', authorId: 'a', spans, deletedAt: null } as never);
    expect(view?.line).toBe(clean);
  });
  it('pinnedText', () => {
    expect(pinnedText({ spans } as never)).toBe(clean);
  });
  it('replySnippet', () => {
    expect(replySnippet(createMessage({ spans: [createSpan({ text: dirty })] }))).toBe(clean);
  });
  it('the announcer line', () => {
    const text = buildPreviewText(
      createMessage({ spans: [createSpan({ text: dirty }), { type: SpanType.SPECIAL_MENTION, specialKind: 'he‮re' } as never] }),
    );
    expect(text).not.toMatch(BIDI);
    expect(text).toContain(clean);
  });
  it('getMessagePreview (notification list)', () => {
    expect(getMessagePreview({ message: { spans } } as never)).toBe(clean);
  });
  it('plainSpanText (desktop notification body)', () => {
    expect(plainSpanText(spans)).toBe(clean);
  });
  it('spansToText keeps the stored text, so editing a message does not rewrite it', () => {
    expect(spansToText(spans)).toBe(dirty);
  });
  it('MessageQuote line and label', () => {
    const { container } = renderWithKit(<MessageQuote author="aiko" line={dirty} onOpen={() => {}} />);
    expect(container.textContent).not.toMatch(BIDI);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(`Reply to aiko: ${clean}`);
  });
  it('QuotePreview', () => {
    const { container } = renderWithProviders(
      <QuotePreview replyTo={{ id: 'm', authorId: 'a', spans, deletedAt: null } as never} directMessageGroupId="dm" />,
    );
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(BIDI);
  });
  it('the DM list row', () => {
    const group = createDmGroup({ lastMessage: { spans } as never });
    const { container } = renderWithProviders(<DmListItem group={group} currentUserId="me" isSelected={false} onClick={() => {}} />);
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(BIDI);
  });
  it('the home unread DM list', () => {
    const group = createDmGroup({ lastMessage: { spans } as never });
    const { container } = render(
      <MemoryRouter>
        <UnreadDmList dms={[{ group, unreadCount: 1 }] as never} currentUserId="me" />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(BIDI);
  });
  it('the search result preview', () => {
    const { container } = renderWithProviders(
      <MessageSearchResultList
        results={[{ id: 'r1', authorId: 'a', spans, sentAt: new Date().toISOString() }] as never}
        scope={'channel' as never}
        query="ab"
        isLoading={false}
        onSelect={() => {}}
      />,
    );
    expect(container.textContent).toContain(clean);
    expect(container.textContent).not.toMatch(BIDI);
  });
});
