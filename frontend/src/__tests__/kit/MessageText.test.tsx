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

  it('never decodes what a link shows: a bidi override, a space or a zero-width space stays %xx', () => {
    renderWithKit(
      <MessageText
        segments={[
          { type: 'link', href: 'https://example.com/\u202Egnp.exe' },
          { type: 'link', href: 'javascript:\u202Ealert(1)' },
        ]}
      />,
    );
    const link = screen.getByRole('link');
    expect(link.textContent).toBe('https://example.com/%E2%80%AEgnp.exe');
    expect(link).toHaveAttribute('href', 'https://example.com/%E2%80%AEgnp.exe');
    // An unsafe address drawn as text drops the control.
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();

    const spaced = 'https://evil.example/%20%20%20%20https://bank.example/login';
    expect(checkLink(spaced)?.label).toBe(spaced);
    expect(checkLink('https://example.com/a%E2%80%8Bb')?.label).toBe('https://example.com/a%E2%80%8Bb');
    expect(checkLink('https://example.com/%E2%80%AE?q=%E2%80%AE#%E2%80%AE')?.label).toBe(
      'https://example.com/%E2%80%AE?q=%E2%80%AE#%E2%80%AE',
    );
    expect(checkLink('https://example.com/\u65E5')?.label).toBe('https://example.com/%E6%97%A5');
    expect(checkLink('https://example.com:8443')).toEqual({ href: 'https://example.com:8443/', label: 'https://example.com:8443/' });
  });

  it('draws an address with a user name or password as text, never as a link (it fakes the host)', () => {
    const faked = 'https://aaaaaaaaaaaa.bank.example@evil.example/login';
    renderWithKit(
      <MessageText
        segments={[
          { type: 'link', href: faked },
          { type: 'text', text: ' ' },
          { type: 'link', href: 'https://user:pass@evil.example/' },
          { type: 'text', text: ' ' },
          { type: 'link', href: 'https://user@evil.example/' },
        ]}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(faked)).toBeInTheDocument();
    expect(checkLink('https://user:pass@evil.example/')).toBeNull();
    expect(checkLink('https://:pass@evil.example/')).toBeNull();
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
    const outside = [
      'data:text/html,x',
      '//evil.example/c',
      '/\\evil.example',
      '/\t/evil.example',
      'javascript:alert(1)',
      'https://evil.example/c',
      'c/clips',
      ' /c',
      // A path that resolves to `//evil.example` (a `.` or `..` segment, or `//` anywhere in the path).
      '/.//evil.example',
      '/..//evil.example',
      '/a/../b',
      '/a/./b',
      '/%2e%2E/b',
      '/c//clips',
      '#/c/../x',
      '#//evil.example',
    ];
    for (const href of outside) expect(internalHref(href)).toBeNull();
    expect(internalHref('/c/clips')).toBe('/c/clips');
    expect(internalHref('#/c/clips')).toBe('#/c/clips');
    expect(internalHref('/c/clips?from=a//b')).toBe('/c/clips?from=a//b');

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

  it('draws a link label and a mention in a left-to-right isolate, with no override left in the text', () => {
    const segments: MessageSegment[] = [
      { type: 'text', text: 'pay at \u202E' },
      { type: 'link', href: 'https://evil.example/x' },
      { type: 'text', text: ' today ' },
      { type: 'mention', kind: 'user', text: '@aiko', id: 'u1' },
    ];
    const { container } = renderWithKit(<MessageText segments={segments} />);
    const link = screen.getByRole('link');
    const label = link.firstElementChild as HTMLElement;
    expect(label.tagName).toBe('BDI');
    expect(label).toHaveAttribute('dir', 'ltr');
    expect(label).toHaveStyle({ unicodeBidi: 'isolate' });
    expect(label).toHaveTextContent('https://evil.example/x');
    // A mention is its own isolate with the direction of its own name (no forced direction).
    const mention = screen.getByText('@aiko');
    expect(mention).toHaveAttribute('dir', 'auto');
    expect(mention).toHaveStyle({ unicodeBidi: 'isolate' });
    expect(container.textContent).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  it.each([
    ['a user mention button', { type: 'mention', kind: 'user', text: '@\u202Eaiko', id: 'u1' }, 'BUTTON', true],
    ['a channel mention link', { type: 'mention', kind: 'channel', text: '#\u202Eclips', id: 'c1', href: '#/c/clips' }, 'A', false],
    ['an unavailable mention', { type: 'mention', kind: 'channel', text: '#\u202Ehidden', unavailable: true }, 'SPAN', false],
    ['a plain mention', { type: 'mention', kind: 'role', text: '@\u202Emods' }, 'SPAN', false],
  ] as const)('%s is its own isolate, with no override in its text', (_name, mention, tag, withHandler) => {
    const { container } = renderWithKit(
      <MessageText segments={[mention as MessageSegment]} onMention={withHandler ? vi.fn() : undefined} />,
    );
    const chip = container.querySelector(tag.toLowerCase() + '[dir="auto"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip).toHaveStyle({ unicodeBidi: 'isolate' });
    expect(chip.querySelector('bdi')).toBeNull();
    expect(container.textContent).not.toMatch(/\u202E/);
  });

  it('draws the text of an address that is not a link in a left-to-right isolate, without controls', () => {
    const { container } = renderWithKit(<MessageText segments={[{ type: 'link', href: 'javascript:\u202Ealert(1)' }]} />);
    const text = container.querySelector('bdi[dir="ltr"]');
    expect(text).not.toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\u202E/);
  });

  it('keeps balanced embeddings and isolates in message text, and drops overrides', () => {
    const { container } = renderWithKit(
      <MessageText segments={[{ type: 'text', text: 'x \u2066123\u2069 y\u202B z\u202DA\u202C' }]} />,
    );
    expect(container.textContent).toBe('x \u2066123\u2069 y\u202B zA\u202C');
  });
});
