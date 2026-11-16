import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MessageText, type MessageSegment } from '../../kit';
import { renderWithKit } from '../test-utils/renderWithKit';
import { expectNoAxeViolations, runAxe } from '../test-utils/a11y';

describe('MessageText', () => {
  it('draws text with its formatting, inline code and a code block', () => {
    const segments: MessageSegment[] = [
      { type: 'text', text: 'bold', bold: true },
      { type: 'text', text: 'italic', italic: true },
      { type: 'text', text: 'struck', strike: true },
      { type: 'code', text: 'x = 1' },
      { type: 'codeBlock', text: 'line one\nline two' },
    ];
    const { container } = renderWithKit(<MessageText segments={segments} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('italic').tagName).toBe('EM');
    expect(screen.getByText('struck').tagName).toBe('S');
    expect(screen.getByText('x = 1').tagName).toBe('CODE');
    const block = container.querySelector('pre');
    expect(block?.textContent).toBe('line one\nline two');
  });

  it('is dir="auto" and keeps line breaks, so right-to-left text and newlines read as written', () => {
    const { container } = renderWithKit(<MessageText segments={[{ type: 'text', text: 'مرحبا\nسلام' }]} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('dir', 'auto');
    expect(root).toHaveStyle({ whiteSpace: 'pre-wrap' });
  });

  it('opens web links in a new tab, and draws any other address as text', () => {
    renderWithKit(
      <MessageText
        segments={[
          { type: 'link', href: 'https://example.com/a' },
          { type: 'link', href: 'https://example.com/b', text: 'named' },
          { type: 'link', href: 'javascript:alert(1)' },
          { type: 'link', href: 'not a url' },
        ]}
      />,
    );
    const plain = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(plain).toHaveAttribute('target', '_blank');
    expect(plain).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'named' })).toHaveAttribute('href', 'https://example.com/b');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull();
  });

  it('makes a user mention a button when onMention is given, and plain text without', () => {
    const onMention = vi.fn();
    const mention: MessageSegment = { type: 'mention', kind: 'user', text: '@aiko', id: 'u1' };
    const { rerender } = renderWithKit(<MessageText segments={[mention]} onMention={onMention} />);
    fireEvent.click(screen.getByRole('button', { name: '@aiko' }));
    expect(onMention).toHaveBeenCalledWith(mention);
    rerender(<MessageText segments={[mention]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('@aiko')).toBeInTheDocument();
  });

  it('routes a plain click on a channel mention in place, but leaves a modified click to the browser', () => {
    const onMention = vi.fn();
    renderWithKit(
      <MessageText segments={[{ type: 'mention', kind: 'channel', text: '#clips', href: '/c/clips' }]} onMention={onMention} />,
    );
    const link = screen.getByRole('link', { name: '#clips' });
    expect(link).toHaveAttribute('href', '/c/clips');
    expect(fireEvent.click(link)).toBe(false);
    expect(onMention).toHaveBeenCalledTimes(1);
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(onMention).toHaveBeenCalledTimes(1);
  });

  it('says when a mention is of the reader, and when a channel is not theirs to open', () => {
    renderWithKit(
      <MessageText
        segments={[
          { type: 'mention', kind: 'user', text: '@alexk', me: true },
          { type: 'mention', kind: 'channel', text: '#private-channel', unavailable: true, href: '/c/x' },
        ]}
        onMention={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '@alexk, mentions you' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/not available to you/)).toBeInTheDocument();
  });

  it('draws a custom emoji as an image named :name:, and as :name: when it has no image or the image fails', () => {
    renderWithKit(
      <MessageText
        segments={[
          { type: 'emoji', name: 'parrot', src: 'https://example.com/p.png' },
          { type: 'emoji', name: 'gone' },
        ]}
      />,
    );
    const image = screen.getByRole('img', { name: ':parrot:' });
    expect(screen.getByText(':gone:')).toBeInTheDocument();
    fireEvent.error(image);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(':parrot:')).toBeInTheDocument();
  });

  it('has no axe violations with every segment type', async () => {
    const { container } = renderWithKit(
      <MessageText
        onMention={vi.fn()}
        segments={[
          { type: 'text', text: 'hi ', bold: true },
          { type: 'mention', kind: 'user', text: '@aiko' },
          { type: 'mention', kind: 'channel', text: '#clips', href: '/c' },
          { type: 'link', href: 'https://example.com' },
          { type: 'code', text: 'a' },
          { type: 'codeBlock', text: 'b' },
          { type: 'emoji', name: 'p', src: 'https://example.com/p.png' },
        ]}
      />,
    );
    expectNoAxeViolations(await runAxe(container));
  });
});
