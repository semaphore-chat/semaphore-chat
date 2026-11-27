import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { MessageSpan, renderMessageSpans } from '../../components/Message/MessageSpan';
import { SpanType } from '../../types/message.type';
import type { Span } from '../../types/message.type';

describe('MessageSpan', () => {
  it('renders PLAINTEXT span text', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'Hello world' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders USER_MENTION span with text content', () => {
    const span: Span = { type: SpanType.USER_MENTION, text: '@testuser', userId: 'u1' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.getByText('@testuser')).toBeInTheDocument();
  });

  it('renders USER_MENTION span with userId fallback when text is absent', () => {
    const span: Span = { type: SpanType.USER_MENTION, userId: 'user-abc-123' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.getByText('user-abc-123')).toBeInTheDocument();
  });

  it('renders SPECIAL_MENTION span with @specialKind text', () => {
    const span: Span = { type: SpanType.SPECIAL_MENTION, specialKind: 'here' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.getByText('@here')).toBeInTheDocument();
  });

  it('renders COMMUNITY_MENTION span with text content', () => {
    const span: Span = { type: SpanType.COMMUNITY_MENTION, text: '#general', communityId: 'c1' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.getByText('#general')).toBeInTheDocument();
  });

  it('renders ALIAS_MENTION span with text content', () => {
    const span: Span = { type: SpanType.ALIAS_MENTION, text: '@devteam', aliasId: 'a1' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.getByText('@devteam')).toBeInTheDocument();
  });
});

describe('MessageSpan URL rendering', () => {
  it('renders a URL as a clickable link', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'Visit https://example.com for info' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    // The kit's link check: the parsed address is what is shown and followed.
    const link = screen.getByRole('link', { name: 'https://example.com/' });
    expect(link).toHaveAttribute('href', 'https://example.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders multiple URLs in one span', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'See https://a.com and http://b.com here' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.getByRole('link', { name: 'https://a.com/' })).toHaveAttribute('href', 'https://a.com/');
    expect(screen.getByRole('link', { name: 'http://b.com/' })).toHaveAttribute('href', 'http://b.com/');
  });

  it('does not render non-URL text as a link', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'no links here' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('no links here')).toBeInTheDocument();
  });

  it('strips trailing sentence punctuation from URLs', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'Check https://example.com.' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    const link = screen.getByRole('link', { name: 'https://example.com/' });
    expect(link).toHaveAttribute('href', 'https://example.com/');
  });

  it('draws an address with a user name as text, and a non-ASCII host as punycode', () => {
    renderWithProviders(
      <MessageSpan span={{ type: SpanType.PLAINTEXT, text: 'a https://bank.example@other.example/x b' }} index={0} />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('https://bank.example@other.example/x')).toBeInTheDocument();
    renderWithProviders(<MessageSpan span={{ type: SpanType.PLAINTEXT, text: 'go https://\u0430pple.com/login' }} index={0} />);
    const link = screen.getByRole('link', { name: 'https://xn--pple-43d.com/login' });
    expect(link).toHaveAttribute('href', 'https://xn--pple-43d.com/login');
  });

  it('preserves dots within URL paths', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'See https://example.com/page.html for details' };
    renderWithProviders(<MessageSpan span={span} index={0} />);
    const link = screen.getByRole('link', { name: 'https://example.com/page.html' });
    expect(link).toHaveAttribute('href', 'https://example.com/page.html');
  });
});

describe('MessageSpan rich-text formatting', () => {
  it('wraps a bold PLAINTEXT span in <strong>', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'bold text', bold: true };
    const { container } = renderWithProviders(<MessageSpan span={span} index={0} />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong).toHaveTextContent('bold text');
  });

  it('wraps an italic PLAINTEXT span in <em>', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'italic text', italic: true };
    const { container } = renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(container.querySelector('em')).toHaveTextContent('italic text');
  });

  it('wraps a strikethrough PLAINTEXT span in <s>', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'struck', strikethrough: true };
    const { container } = renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(container.querySelector('s')).toHaveTextContent('struck');
  });

  it('composes bold + italic by nesting <strong> and <em>', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'both', bold: true, italic: true };
    const { container } = renderWithProviders(<MessageSpan span={span} index={0} />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.querySelector('em')).toHaveTextContent('both');
  });

  it('renders an inline code span in <code> without auto-linking', () => {
    const span: Span = { type: SpanType.PLAINTEXT, text: 'https://example.com', code: true };
    const { container } = renderWithProviders(<MessageSpan span={span} index={0} />);
    expect(container.querySelector('code')).toHaveTextContent('https://example.com');
    // Code is verbatim — no link element should be produced.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a CODE_BLOCK span as a <pre><code> block', () => {
    const span: Span = { type: SpanType.CODE_BLOCK, text: 'const x = 1;\nconst y = 2;' };
    const { container } = renderWithProviders(<MessageSpan span={span} index={0} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.querySelector('code')).toHaveTextContent('const x = 1;');
  });
});

describe('renderMessageSpans', () => {
  it('renders an array of multiple spans correctly', () => {
    const spans: Span[] = [
      { type: SpanType.PLAINTEXT, text: 'Hello ' },
      { type: SpanType.USER_MENTION, text: '@alice', userId: 'u1' },
      { type: SpanType.PLAINTEXT, text: ' welcome to ' },
      { type: SpanType.COMMUNITY_MENTION, text: '#general', communityId: 'c1' },
    ];
    renderWithProviders(<div>{renderMessageSpans(spans)}</div>);
    expect(screen.getByText('Hello', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('welcome to', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('#general')).toBeInTheDocument();
  });
});

describe('MessageSpan custom emoji (EMOJI)', () => {
  const emojiById = new Map([
    ['e1', { id: 'e1', communityId: 'c1', name: 'party_blob', fileId: 'file-1', createdBy: null, createdAt: '2026-01-01' }],
  ]);

  it('renders a known EMOJI span as an inline image', () => {
    const span: Span = { type: SpanType.EMOJI, text: ':party_blob:', emojiId: 'e1' };
    renderWithProviders(<MessageSpan span={span} index={0} emojiById={emojiById} />);
    const img = screen.getByRole('img', { name: ':party_blob:' });
    expect(img).toHaveAttribute('src', '/api/file/file-1');
    expect(img).toHaveAttribute('title', ':party_blob:');
  });

  it('falls back to shortcode text when the emoji is unknown/deleted', () => {
    const span: Span = { type: SpanType.EMOJI, text: ':gone:', emojiId: 'missing' };
    renderWithProviders(<MessageSpan span={span} index={0} emojiById={emojiById} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(':gone:')).toBeInTheDocument();
  });
});
