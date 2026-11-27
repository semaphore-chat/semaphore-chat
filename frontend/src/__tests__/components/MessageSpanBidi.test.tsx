import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { renderMessageSpans } from '../../components/Message/MessageSpan';
import { SpanType, type Span } from '../../types/message.type';

describe('MessageSpan bidi isolation', () => {
  it('draws a link label and a mention in a left-to-right isolate and leaves no override in the text', () => {
    const spans = [
      { type: SpanType.PLAINTEXT, text: 'pay at ‮https://evil.example/x today ⁧ok⁩ ‏' },
      { type: SpanType.USER_MENTION, text: '@ai‮ko', userId: 'u1' },
    ] as Span[];
    const { container } = renderWithProviders(<div>{renderMessageSpans(spans)}</div>);

    const label = screen.getByRole('link').querySelector('bdi[dir="ltr"]');
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent('https://evil.example/x');
    expect(label).toHaveStyle({ unicodeBidi: 'isolate' });

    const mention = screen.getByText('@aiko');
    expect(mention.tagName).toBe('BDI');
    expect(mention).toHaveAttribute('dir', 'ltr');

    expect(container.textContent).not.toMatch(/[‪-‮⁦-⁩]/);
    expect(container.textContent).toContain('‏');
  });
});
