import { describe, it, expect } from 'vitest';
import { isUserMentioned, getLoneGifUrl, getMessageLoneGifUrl } from '../../components/Message/messageUtils';
import { SpanType } from '../../types/message.type';
import { createMessage } from '../test-utils/factories';

describe('isUserMentioned', () => {
  it('returns true for direct USER_MENTION with matching userId', () => {
    const message = createMessage({
      spans: [{ type: SpanType.USER_MENTION, text: '@alice', userId: 'user-42' }],
    });
    expect(isUserMentioned(message, 'user-42')).toBe(true);
  });

  it('returns true for SPECIAL_MENTION @here', () => {
    const message = createMessage({
      spans: [{ type: SpanType.SPECIAL_MENTION, text: '@here', specialKind: 'here' }],
    });
    expect(isUserMentioned(message, 'any-user')).toBe(true);
  });

  it('returns true for SPECIAL_MENTION @channel', () => {
    const message = createMessage({
      spans: [{ type: SpanType.SPECIAL_MENTION, text: '@channel', specialKind: 'channel' }],
    });
    expect(isUserMentioned(message, 'any-user')).toBe(true);
  });

  it('returns true for ALIAS_MENTION with matching group ID in userAliasGroupIds', () => {
    const message = createMessage({
      spans: [{ type: SpanType.ALIAS_MENTION, text: '@devs', aliasId: 'alias-1' }],
    });
    expect(isUserMentioned(message, 'user-42', ['alias-1', 'alias-2'])).toBe(true);
  });

  it('returns false for ALIAS_MENTION without userAliasGroupIds', () => {
    const message = createMessage({
      spans: [{ type: SpanType.ALIAS_MENTION, text: '@devs', aliasId: 'alias-1' }],
    });
    expect(isUserMentioned(message, 'user-42')).toBe(false);
  });

  it('returns false when there are no mention spans', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: 'hello world' }],
    });
    expect(isUserMentioned(message, 'user-42')).toBe(false);
  });

  it('returns false when userId is undefined', () => {
    const message = createMessage({
      spans: [{ type: SpanType.USER_MENTION, text: '@alice', userId: 'user-42' }],
    });
    expect(isUserMentioned(message, undefined)).toBe(false);
  });

  it('returns false for USER_MENTION with different userId', () => {
    const message = createMessage({
      spans: [{ type: SpanType.USER_MENTION, text: '@alice', userId: 'user-42' }],
    });
    expect(isUserMentioned(message, 'user-99')).toBe(false);
  });
});

describe('getLoneGifUrl', () => {
  it('returns the URL for a lone Giphy media URL', () => {
    const url = 'https://media.giphy.com/media/abc123/giphy.gif';
    expect(getLoneGifUrl(url)).toBe(url);
  });

  it('returns the URL for a numbered Giphy CDN host (media4.giphy.com)', () => {
    const url = 'https://media4.giphy.com/media/abc123/giphy.gif';
    expect(getLoneGifUrl(url)).toBe(url);
  });

  it('returns the URL for a lone Tenor media URL (legacy)', () => {
    const url = 'https://media.tenor.com/abc123/cat.gif';
    expect(getLoneGifUrl(url)).toBe(url);
  });

  it('returns the URL for a numbered Tenor CDN host (media3.tenor.com)', () => {
    const url = 'https://media3.tenor.com/abc123/cat.gif';
    expect(getLoneGifUrl(url)).toBe(url);
  });

  it('returns the URL for a .gif path on any other host', () => {
    const url = 'https://example.com/images/cat.gif';
    expect(getLoneGifUrl(url)).toBe(url);
  });

  it('is case-insensitive for the .gif extension', () => {
    const url = 'https://example.com/images/cat.GIF';
    expect(getLoneGifUrl(url)).toBe(url);
  });

  it('returns the URL when .gif is followed by a query string', () => {
    const url = 'https://example.com/images/cat.gif?width=200&quality=80';
    expect(getLoneGifUrl(url)).toBe(url);
  });

  it('returns null when the URL has surrounding text', () => {
    expect(getLoneGifUrl('check this out https://media.giphy.com/media/abc/giphy.gif')).toBeNull();
    expect(getLoneGifUrl('https://media.giphy.com/media/abc/giphy.gif look at this')).toBeNull();
  });

  it('returns null when there are two URLs', () => {
    expect(
      getLoneGifUrl(
        'https://media.giphy.com/media/abc/giphy.gif https://media.tenor.com/xyz/cat.gif',
      ),
    ).toBeNull();
  });

  it('returns null for a non-GIF URL', () => {
    expect(getLoneGifUrl('https://example.com/page.html')).toBeNull();
  });

  it('returns the URL for a .gif path even on a giphy-lookalike hostname (path rule, not host rule)', () => {
    expect(getLoneGifUrl('https://notgiphy.com/media/abc/giphy.gif')).toBe(
      'https://notgiphy.com/media/abc/giphy.gif',
    );
  });

  it('returns null for a non-.gif path on a giphy-lookalike hostname', () => {
    expect(getLoneGifUrl('https://notgiphy.com/media/abc/giphy.png')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(getLoneGifUrl('')).toBeNull();
  });

  it('returns null for undefined content', () => {
    expect(getLoneGifUrl(undefined)).toBeNull();
  });

  it('returns null for null content', () => {
    expect(getLoneGifUrl(null)).toBeNull();
  });

  it('returns null for garbage (unparsable) content', () => {
    expect(getLoneGifUrl('not a url at all')).toBeNull();
  });

  it('returns null for whitespace-only content', () => {
    expect(getLoneGifUrl('   \n\t  ')).toBeNull();
  });

  it('trims surrounding whitespace around an otherwise-lone URL', () => {
    const url = 'https://media.giphy.com/media/abc/giphy.gif';
    expect(getLoneGifUrl(`  ${url}  `)).toBe(url);
  });
});

describe('getMessageLoneGifUrl', () => {
  const giphyUrl = 'https://media.giphy.com/media/abc123/giphy.gif';

  it('returns the URL for a sole non-code PLAINTEXT span containing a GIF URL', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: giphyUrl }],
    });
    expect(getMessageLoneGifUrl(message)).toBe(giphyUrl);
  });

  it('returns null when there is more than one span', () => {
    const message = createMessage({
      spans: [
        { type: SpanType.PLAINTEXT, text: 'check this out ' },
        { type: SpanType.PLAINTEXT, text: giphyUrl },
      ],
    });
    expect(getMessageLoneGifUrl(message)).toBeNull();
  });

  it('returns null when the message has attachments', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: giphyUrl }],
      attachments: [
        { id: 'file-1', filename: 'a.png', mimeType: 'image/png', fileType: 'IMAGE', size: 10, hasThumbnail: false },
      ],
    });
    expect(getMessageLoneGifUrl(message)).toBeNull();
  });

  it('returns null for a non-PLAINTEXT sole span', () => {
    const message = createMessage({
      spans: [{ type: SpanType.USER_MENTION, text: giphyUrl, userId: 'user-1' }],
    });
    expect(getMessageLoneGifUrl(message)).toBeNull();
  });

  it('returns null when the sole span is an inline-code span', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: giphyUrl, code: true }],
    });
    expect(getMessageLoneGifUrl(message)).toBeNull();
  });

  it('returns the URL when the sole span has other formatting flags (bold)', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: giphyUrl, bold: true }],
    });
    expect(getMessageLoneGifUrl(message)).toBe(giphyUrl);
  });

  it('returns null for a plain-text message', () => {
    const message = createMessage({
      spans: [{ type: SpanType.PLAINTEXT, text: 'hello world' }],
    });
    expect(getMessageLoneGifUrl(message)).toBeNull();
  });
});
