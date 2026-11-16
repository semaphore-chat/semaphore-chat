import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MessageText, type MessageSegment } from '../../kit';
import { checkLink, internalHref } from '../../kit/chat/messageSegments';
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
          { type: 'link', href: 'javascript:alert(1)' },
          { type: 'link', href: 'data:text/html,<b>x</b>' },
          { type: 'link', href: 'not a url' },
        ]}
      />,
    );
    const plain = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(plain).toHaveAttribute('href', 'https://example.com/a');
    expect(plain).toHaveAttribute('target', '_blank');
    expect(plain).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull();
    expect(screen.getByText('data:text/html,<b>x</b>').closest('a')).toBeNull();
  });

  it('shows a lookalike host as punycode, in the label and the address', () => {
    // "аpple.com" with a Cyrillic а (U+0430).
    renderWithKit(<MessageText segments={[{ type: 'link', href: 'https://\u0430pple.com/login' }]} />);
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent(/^https:\/\/xn--pple-43d\.com\/login$/);
    expect(link).toHaveAttribute('href', 'https://xn--pple-43d.com/login');
  });

  it('drops bidi controls from what a link shows, so a right-to-left override cannot reorder it', () => {
    renderWithKit(
      <MessageText
        segments={[
          { type: 'link', href: 'https://example.com/\u202Egnp.exe' },
          { type: 'link', href: 'javascript:\u202Ealert(1)' },
        ]}
      />,
    );
    const link = screen.getByRole('link');
    expect(link.textContent).toBe('https://example.com/gnp.exe');
    expect(link.textContent).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/);
    // The address followed keeps the character, encoded.
    expect(link).toHaveAttribute('href', 'https://example.com/%E2%80%AEgnp.exe');
    // An unsafe address drawn as text drops it too.
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
  });

  it('reads a non-Latin path decoded, but never a line break', () => {
    expect(checkLink('https://ja.wikipedia.org/wiki/\u65E5\u672C')?.label).toBe('https://ja.wikipedia.org/wiki/\u65E5\u672C');
    expect(checkLink('https://example.com/a%0Ab')?.label).toBe('https://example.com/a%0Ab');
    expect(checkLink('https://example.com/%E0%A4%A')?.label).toBe('https://example.com/%E0%A4%A');
    expect(checkLink('https://example.com')).toEqual({ href: 'https://example.com/', label: 'https://example.com' });
  });

  it('keeps a formatted span on a link inside it (bold, italic, struck)', () => {
    renderWithKit(
      <MessageText
        segments={[
          { type: 'link', href: 'https://example.com/b', bold: true },
          { type: 'link', href: 'https://example.com/i', italic: true },
          { type: 'link', href: 'https://example.com/s', strike: true },
          { type: 'link', href: 'javascript:void(0)', bold: true },
        ]}
      />,
    );
    expect(screen.getByText('https://example.com/b').tagName).toBe('STRONG');
    expect(screen.getByText('https://example.com/b').closest('a')).not.toBeNull();
    expect(screen.getByText('https://example.com/i').tagName).toBe('EM');
    expect(screen.getByText('https://example.com/s').tagName).toBe('S');
    expect(screen.getByText('javascript:void(0)').tagName).toBe('STRONG');
  });

  it('follows a mention only to an app-internal address: a hash route or a single-slash path', () => {
    const outside = ['data:text/html,x', '//evil.example/c', '/\\evil.example', '/\t/evil.example', 'javascript:alert(1)', 'https://evil.example/c', 'c/clips', ' /c'];
    for (const href of outside) expect(internalHref(href)).toBeNull();
    expect(internalHref('/c/clips')).toBe('/c/clips');
    expect(internalHref('#/c/clips')).toBe('#/c/clips');

    renderWithKit(
      <MessageText
        onMention={vi.fn()}
        segments={[
          { type: 'mention', kind: 'channel', text: '#data', href: 'data:text/html,x' },
          { type: 'mention', kind: 'channel', text: '#far', href: '//evil.example/c' },
          { type: 'mention', kind: 'channel', text: '#js', href: 'javascript:alert(1)' },
          { type: 'mention', kind: 'channel', text: '#home', href: '#/c/home' },
        ]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '#home' })).toHaveAttribute('href', '#/c/home');
    for (const text of ['#data', '#far', '#js']) {
      expect(screen.getByText(text).closest('a')).toBeNull();
      expect(screen.getByText(text).closest('button')).toBeNull();
    }
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
