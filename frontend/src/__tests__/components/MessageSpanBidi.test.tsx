import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { toSegments } from '../../data/chat/toSegments';
import { checkLink } from '../../utils/links';
import { renderMessageSpans } from '../../components/Message/MessageSpan';
import { SpanType, type Span } from '../../types/message.type';

describe('MessageSpan bidi isolation', () => {
  it('strips unpaired controls, keeps balanced pairs, and always drops overrides', () => {
    const spans = [
      { type: SpanType.PLAINTEXT, text: 'a\u202Bb\u202Cc \u2067d\u2069 e\u202D f\u202E g\u2066h' },
    ] as Span[];
    const { container } = renderWithProviders(<div>{renderMessageSpans(spans)}</div>);
    expect(container.textContent).toBe('a\u202Bb\u202Cc \u2067d\u2069 e f gh');
  });

  it('strips the custom emoji fallback and the special mention', () => {
    const spans = [
      { type: SpanType.EMOJI, text: ':pa\u202Erty:', emojiId: 'missing' },
      { type: SpanType.SPECIAL_MENTION, specialKind: 'here\u202E' },
    ] as Span[];
    const { container } = renderWithProviders(<div>{renderMessageSpans(spans)}</div>);
    expect(container.textContent).toBe(':party:@here');
  });

  it('draws a link label and a mention in a left-to-right isolate and leaves no override in the text', () => {
    const spans = [
      { type: SpanType.PLAINTEXT, text: 'pay at ‮https://evil.example/x today \u2067ok ‏' },
      { type: SpanType.USER_MENTION, text: '@ai‮ko', userId: 'u1' },
    ] as Span[];
    const { container } = renderWithProviders(<div>{renderMessageSpans(spans)}</div>);

    const label = screen.getByRole('link').querySelector('bdi[dir="ltr"]');
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent('https://evil.example/x');
    expect(label).toHaveStyle({ unicodeBidi: 'isolate' });

    // The mention is its own isolate and takes its direction from its own name (no forced direction).
    const mention = screen.getByText('@aiko');
    expect(mention).toHaveAttribute('dir', 'auto');
    expect(mention).toHaveStyle({ unicodeBidi: 'isolate' });

    expect(container.textContent).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(container.textContent).toContain('‏');
  });

  it('strips the fallback of a known custom emoji whose image fails to load', () => {
    const emojiById = new Map([['e1', { id: 'e1', name: 'party', fileId: 'file-1' }]]) as never;
    const spans = [{ type: SpanType.EMOJI, text: ':pa\u202Erty:', emojiId: 'e1' }] as Span[];
    const { container } = renderWithProviders(<div>{renderMessageSpans(spans, emojiById)}</div>);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.textContent).toBe(':party:');
  });

  // Text is split at addresses first and each part cleaned, as the kit does: the same address in both renderers.
  it.each([
    ['a balanced pair closing right after an address', '\u2067see https://example.com/x\u2069', ['https://example.com/x']],
    ['an override inside a path', 'go https://example.com/a\u202Eb now', ['https://example.com/a']],
    ['an override inside the host (the address ends there)', 'go https://exa\u202Emple.com/ now', ['https://exa']],
    ['a stray PDF after an address', 'https://example.com/x\u202C trailing', ['https://example.com/x']],
    ['an unpaired opener before an address', 'a\u202B https://example.com/p b', ['https://example.com/p']],
  ])('links the same address as the kit for %s', (_name, text, hrefs) => {
    const { container } = renderWithProviders(<div>{renderMessageSpans([{ type: SpanType.PLAINTEXT, text }] as Span[])}</div>);
    const classic = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    const kit = toSegments([{ type: SpanType.PLAINTEXT, text }] as Span[])
      .flatMap((segment) => (segment.type === 'link' ? [checkLink(segment.href)?.href ?? null] : []))
      .filter((href) => href !== null);
    expect(classic).toEqual(kit);
    expect(classic.map((href) => href?.replace(/\/$/, ''))).toEqual(hrefs);
    expect(container.textContent).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });
});
