import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
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
});
