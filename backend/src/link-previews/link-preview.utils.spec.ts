import {
  extractUrls,
  fetchLinkMetadata,
  parseOpenGraphTags,
  sanitizePreview,
  isPublicUrl,
  findOEmbedProvider,
  mergeOEmbedData,
  LinkPreviewData,
} from './link-preview.utils';
import * as dns from 'dns';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import * as undici from 'undici';

jest.mock('dns', () => ({
  // The callback lookup is what the connection itself uses
  lookup: jest.fn(),
  promises: {
    lookup: jest.fn(),
  },
}));

const mockLookup = dns.promises.lookup as jest.Mock<any>;
const mockConnectLookup = dns.lookup as unknown as jest.Mock<any>;

describe('link-preview.utils', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('extractUrls', () => {
    it('should return empty array when text has no URLs', () => {
      expect(extractUrls('hello world no links here')).toEqual([]);
    });

    it('should extract a single URL', () => {
      const text = 'Check out https://example.com for more';
      expect(extractUrls(text)).toEqual(['https://example.com']);
    });

    it('should extract multiple URLs', () => {
      const text = 'Visit https://example.com and http://test.org for info';
      expect(extractUrls(text)).toEqual([
        'https://example.com',
        'http://test.org',
      ]);
    });

    it('should deduplicate URLs', () => {
      const text =
        'Go to https://example.com and again https://example.com please';
      expect(extractUrls(text)).toEqual(['https://example.com']);
    });

    it('should cap at 5 URLs', () => {
      const urls = Array.from({ length: 8 }, (_, i) => `https://site${i}.com`);
      const text = urls.join(' ');
      const result = extractUrls(text);
      expect(result).toHaveLength(5);
      expect(result).toEqual(urls.slice(0, 5));
    });

    it('should strip trailing punctuation from URLs', () => {
      const cases = [
        ['See https://example.com.', 'https://example.com'],
        ['Link: https://example.com,', 'https://example.com'],
        ['Wow https://example.com!', 'https://example.com'],
        ['Is it https://example.com?', 'https://example.com'],
        ['At https://example.com;', 'https://example.com'],
        ['From https://example.com:', 'https://example.com'],
      ];
      for (const [input, expected] of cases) {
        expect(extractUrls(input)).toEqual([expected]);
      }
    });

    it('should return empty array for empty string', () => {
      expect(extractUrls('')).toEqual([]);
    });
  });

  describe('parseOpenGraphTags', () => {
    const baseUrl = 'https://example.com/page';

    it('should parse og:title', () => {
      const html = '<meta property="og:title" content="My Title" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.title).toBe('My Title');
    });

    it('should parse og:description', () => {
      const html =
        '<meta property="og:description" content="My Description" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.description).toBe('My Description');
    });

    it('should parse og:image with absolute URL', () => {
      const html =
        '<meta property="og:image" content="https://cdn.example.com/img.png" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.imageUrl).toBe('https://cdn.example.com/img.png');
    });

    it('should parse og:site_name', () => {
      const html = '<meta property="og:site_name" content="Example Site" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.siteName).toBe('Example Site');
    });

    it('should parse all og tags together', () => {
      const html = `
        <html>
          <head>
            <meta property="og:title" content="Full OG" />
            <meta property="og:description" content="Full desc" />
            <meta property="og:image" content="https://img.test/og.jpg" />
            <meta property="og:site_name" content="TestSite" />
          </head>
        </html>
      `;
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result).toEqual({
        title: 'Full OG',
        description: 'Full desc',
        imageUrl: 'https://img.test/og.jpg',
        siteName: 'TestSite',
      });
    });

    it('should fallback to <title> tag when no og:title', () => {
      const html = '<html><head><title>Page Title</title></head></html>';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.title).toBe('Page Title');
    });

    it('should prefer og:title over <title> tag', () => {
      const html = `
        <head>
          <title>Fallback Title</title>
          <meta property="og:title" content="OG Title" />
        </head>
      `;
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.title).toBe('OG Title');
    });

    it('should fallback to <meta name="description"> when no og:description', () => {
      const html =
        '<meta name="description" content="Meta description text" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.description).toBe('Meta description text');
    });

    it('should prefer og:description over meta description', () => {
      const html = `
        <meta name="description" content="Fallback desc" />
        <meta property="og:description" content="OG desc" />
      `;
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.description).toBe('OG desc');
    });

    it('should resolve relative image URL against baseUrl', () => {
      const html = '<meta property="og:image" content="/images/thumb.png" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.imageUrl).toBe('https://example.com/images/thumb.png');
    });

    it('should extract favicon from <link rel="icon">', () => {
      const html = '<link rel="icon" href="/favicon.ico" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.faviconUrl).toBe('https://example.com/favicon.ico');
    });

    it('should extract favicon from <link rel="shortcut icon">', () => {
      const html =
        '<link rel="shortcut icon" href="https://cdn.example.com/fav.png" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.faviconUrl).toBe('https://cdn.example.com/fav.png');
    });

    it('should handle content attribute before property attribute', () => {
      const html = '<meta content="Reversed Tag" property="og:title" />';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result.title).toBe('Reversed Tag');
    });

    it('should return empty object for HTML with no tags', () => {
      const html = '<html><body>No meta tags here</body></html>';
      const result = parseOpenGraphTags(html, baseUrl);
      expect(result).toEqual({});
    });
  });

  describe('sanitizePreview', () => {
    it('should strip HTML from title', () => {
      const preview: Partial<LinkPreviewData> = {
        title: '<b>Bold</b> Title',
      };
      const result = sanitizePreview(preview);
      expect(result.title).toBe('Bold Title');
    });

    it('should strip HTML from description', () => {
      const preview: Partial<LinkPreviewData> = {
        description: '<script>alert("xss")</script>Clean text',
      };
      const result = sanitizePreview(preview);
      expect(result.description).toBe('alert("xss")Clean text');
    });

    it('should truncate title to 200 characters', () => {
      const longTitle = 'A'.repeat(250);
      const result = sanitizePreview({ title: longTitle });
      expect(result.title).toHaveLength(200);
    });

    it('should truncate description to 300 characters', () => {
      const longDesc = 'B'.repeat(350);
      const result = sanitizePreview({ description: longDesc });
      expect(result.description).toHaveLength(300);
    });

    it('should truncate siteName to 100 characters', () => {
      const longSite = 'C'.repeat(150);
      const result = sanitizePreview({ siteName: longSite });
      expect(result.siteName).toHaveLength(100);
    });

    it('should keep valid http imageUrl', () => {
      const result = sanitizePreview({
        imageUrl: 'https://cdn.example.com/img.png',
      });
      expect(result.imageUrl).toBe('https://cdn.example.com/img.png');
    });

    it('should filter out invalid imageUrl', () => {
      const result = sanitizePreview({
        imageUrl: 'javascript:alert(1)',
      });
      expect(result.imageUrl).toBeUndefined();
    });

    it('should filter out non-http imageUrl', () => {
      const result = sanitizePreview({
        imageUrl: 'ftp://example.com/img.png',
      });
      expect(result.imageUrl).toBeUndefined();
    });

    it('should keep valid http faviconUrl', () => {
      const result = sanitizePreview({
        faviconUrl: 'https://example.com/favicon.ico',
      });
      expect(result.faviconUrl).toBe('https://example.com/favicon.ico');
    });

    it('should filter out invalid faviconUrl', () => {
      const result = sanitizePreview({
        faviconUrl: 'not-a-url',
      });
      expect(result.faviconUrl).toBeUndefined();
    });

    it('should decode HTML entities', () => {
      const result = sanitizePreview({
        title: 'Tom &amp; Jerry &lt;3&gt;',
      });
      expect(result.title).toBe('Tom & Jerry <3>');
    });

    it('should return empty object for empty preview', () => {
      expect(sanitizePreview({})).toEqual({});
    });

    it('should handle preview with all fields', () => {
      const preview: Partial<LinkPreviewData> = {
        title: '<em>Title</em>',
        description: '<p>Desc</p>',
        imageUrl: 'https://img.test/pic.jpg',
        siteName: 'Site&amp;Name',
        faviconUrl: 'https://img.test/fav.ico',
      };
      const result = sanitizePreview(preview);
      expect(result).toEqual({
        title: 'Title',
        description: 'Desc',
        imageUrl: 'https://img.test/pic.jpg',
        siteName: 'Site&Name',
        faviconUrl: 'https://img.test/fav.ico',
      });
    });
  });

  describe('isPublicUrl', () => {
    it('should block localhost (127.0.0.1)', async () => {
      mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      expect(await isPublicUrl('localhost')).toBe(false);
    });

    it('should block 127.x.x.x range', async () => {
      mockLookup.mockResolvedValue([{ address: '127.0.0.2', family: 4 }]);
      expect(await isPublicUrl('some-host')).toBe(false);
    });

    it('should block 10.x.x.x private range', async () => {
      mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
      expect(await isPublicUrl('internal.corp')).toBe(false);
    });

    it('should block 172.16.x.x private range', async () => {
      mockLookup.mockResolvedValue([{ address: '172.16.0.1', family: 4 }]);
      expect(await isPublicUrl('internal.corp')).toBe(false);
    });

    it('should block 172.31.x.x private range', async () => {
      mockLookup.mockResolvedValue([{ address: '172.31.255.1', family: 4 }]);
      expect(await isPublicUrl('internal.corp')).toBe(false);
    });

    it('should block 192.168.x.x private range', async () => {
      mockLookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);
      expect(await isPublicUrl('home.local')).toBe(false);
    });

    it('should block 169.254.x.x link-local range', async () => {
      mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      expect(await isPublicUrl('metadata.cloud')).toBe(false);
    });

    it('should block IPv6 loopback ::1', async () => {
      mockLookup.mockResolvedValue([{ address: '::1', family: 6 }]);
      expect(await isPublicUrl('localhost6')).toBe(false);
    });

    it('should block IPv6 unspecified ::', async () => {
      mockLookup.mockResolvedValue([{ address: '::', family: 6 }]);
      expect(await isPublicUrl('any')).toBe(false);
    });

    it('should allow public IP addresses', async () => {
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      expect(await isPublicUrl('example.com')).toBe(true);
    });

    it('should allow another public IP', async () => {
      mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
      expect(await isPublicUrl('dns.google')).toBe(true);
    });

    it('should return false when DNS lookup fails', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
      expect(await isPublicUrl('nonexistent.invalid')).toBe(false);
    });

    it('should not block 172.15.x.x (outside private range)', async () => {
      mockLookup.mockResolvedValue([{ address: '172.15.0.1', family: 4 }]);
      expect(await isPublicUrl('edge-case.net')).toBe(true);
    });

    it.each([
      ['CGNAT', '100.64.0.1'],
      ['top of CGNAT', '100.127.255.254'],
      ['benchmarking', '198.18.0.1'],
      ['IETF assignments', '192.0.0.1'],
      ['documentation', '203.0.113.7'],
      ['multicast', '224.0.0.1'],
      ['reserved', '240.0.0.1'],
      ['broadcast', '255.255.255.255'],
      ['unique local, fc00::/7 low half', 'fc01::1'],
      ['unique local, fc00::/7 end', 'fdff::1'],
      ['link-local, fe80::/10 end', 'febf::1'],
      ['site-local', 'fec0::1'],
      ['IPv6 multicast', 'ff02::1'],
      ['IPv4-mapped private', '::ffff:10.0.0.1'],
      ['IPv4-mapped CGNAT', '::ffff:100.64.0.1'],
      ['IPv4-mapped in hex', '::ffff:7f00:1'],
      ['IPv4-compatible', '::7f00:1'],
      ['NAT64', '64:ff9b::a00:1'],
      ['6to4', '2002:a00:1::1'],
      ['Teredo', '2001:0:a00:1::1'],
    ])('should block %s (%s)', async (_what, address) => {
      mockLookup.mockResolvedValue([{ address, family: 0 }]);
      expect(await isPublicUrl('rebound.example')).toBe(false);
    });

    it.each(['[::1]', '[fd00::1]', '[::ffff:7f00:1]', '127.0.0.1'])(
      'should block the IP literal %s without asking DNS',
      async (hostname) => {
        mockLookup.mockClear();
        expect(await isPublicUrl(hostname)).toBe(false);
        expect(mockLookup).not.toHaveBeenCalled();
      },
    );

    it('should allow a public IPv6 literal and a public IPv6 answer', async () => {
      expect(await isPublicUrl('[2606:4700:4700::1111]')).toBe(true);
      mockLookup.mockResolvedValue([
        { address: '2606:4700:4700::1111', family: 6 },
      ]);
      expect(await isPublicUrl('one.example')).toBe(true);
    });

    it('should not block 172.32.x.x (outside private range)', async () => {
      mockLookup.mockResolvedValue([{ address: '172.32.0.1', family: 4 }]);
      expect(await isPublicUrl('edge-case.net')).toBe(true);
    });
  });

  describe('findOEmbedProvider', () => {
    it('should match YouTube watch URLs', () => {
      expect(
        findOEmbedProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
      ).not.toBeNull();
      expect(
        findOEmbedProvider('https://youtube.com/watch?v=abc'),
      ).not.toBeNull();
    });

    it('should match YouTube short URLs', () => {
      expect(findOEmbedProvider('https://youtu.be/dQw4w9WgXcQ')).not.toBeNull();
    });

    it('should match YouTube Shorts', () => {
      expect(
        findOEmbedProvider('https://www.youtube.com/shorts/abc123'),
      ).not.toBeNull();
    });

    it('should match Spotify URLs', () => {
      expect(
        findOEmbedProvider('https://open.spotify.com/track/abc'),
      ).not.toBeNull();
    });

    it('should match Vimeo URLs', () => {
      expect(findOEmbedProvider('https://vimeo.com/123456')).not.toBeNull();
    });

    it('should match TikTok URLs', () => {
      expect(
        findOEmbedProvider('https://www.tiktok.com/@user/video/123'),
      ).not.toBeNull();
    });

    it('should return null for non-matching URLs', () => {
      expect(findOEmbedProvider('https://example.com')).toBeNull();
      expect(findOEmbedProvider('https://www.reddit.com/r/test')).toBeNull();
      expect(findOEmbedProvider('https://github.com/test')).toBeNull();
    });
  });

  describe('mergeOEmbedData', () => {
    it('should prefer oEmbed thumbnail over OG image', () => {
      const og: Partial<LinkPreviewData> = {
        title: 'OG Title',
        imageUrl: 'https://og-image.jpg',
        siteName: 'OG Site',
      };
      const oembed = {
        thumbnail_url: 'https://oembed-thumb.jpg',
        provider_name: 'oEmbed Provider',
        title: 'oEmbed Title',
      };
      const merged = mergeOEmbedData(og, oembed);
      expect(merged.imageUrl).toBe('https://oembed-thumb.jpg');
    });

    it('should keep OG image when oEmbed has no thumbnail', () => {
      const og: Partial<LinkPreviewData> = { imageUrl: 'https://og-image.jpg' };
      const oembed = {};
      const merged = mergeOEmbedData(og, oembed);
      expect(merged.imageUrl).toBe('https://og-image.jpg');
    });

    it('should use OG title over oEmbed title', () => {
      const og: Partial<LinkPreviewData> = { title: 'OG Title' };
      const oembed = { title: 'oEmbed Title' };
      const merged = mergeOEmbedData(og, oembed);
      expect(merged.title).toBe('OG Title');
    });

    it('should fall back to oEmbed title when OG has none', () => {
      const og: Partial<LinkPreviewData> = {};
      const oembed = { title: 'oEmbed Title' };
      const merged = mergeOEmbedData(og, oembed);
      expect(merged.title).toBe('oEmbed Title');
    });

    it('should add author_name from oEmbed', () => {
      const og: Partial<LinkPreviewData> = { title: 'Test' };
      const oembed = { author_name: 'Rick Astley' };
      const merged = mergeOEmbedData(og, oembed);
      expect(merged.authorName).toBe('Rick Astley');
    });

    it('should use provider_name as siteName fallback', () => {
      const og: Partial<LinkPreviewData> = {};
      const oembed = { provider_name: 'YouTube' };
      const merged = mergeOEmbedData(og, oembed);
      expect(merged.siteName).toBe('YouTube');
    });

    it('should keep OG siteName over oEmbed provider_name', () => {
      const og: Partial<LinkPreviewData> = { siteName: 'OG Site' };
      const oembed = { provider_name: 'oEmbed Provider' };
      const merged = mergeOEmbedData(og, oembed);
      expect(merged.siteName).toBe('OG Site');
    });
  });

  describe('fetchLinkMetadata redirects', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each([
      'http://[fc01::1]/',
      'http://[fe90::1]/',
      'http://[::ffff:7f00:1]/',
      'http://100.64.0.1/',
      'http://169.254.169.254/latest/meta-data/',
    ])('should not follow a redirect to %s', async (location) => {
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const fetchSpy = jest
        .spyOn(undici, 'fetch')
        .mockResolvedValue(
          new undici.Response(null, { status: 302, headers: { location } }),
        );

      expect(await fetchLinkMetadata('https://example.com/r')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchLinkMetadata DNS rebinding', () => {
    let server: Server;
    let port: number;
    let requests = 0;

    beforeAll(async () => {
      server = createServer((_req, res) => {
        requests += 1;
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head><title>internal</title></head></html>');
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('re-checks the address at connect time, so a name that passed the check cannot connect inside', async () => {
      requests = 0;
      // The check sees a public address; every later answer is loopback
      // (TTL 0 rebinding). `localhost` makes a real connection reach the
      // internal server if the connection does its own, unchecked lookup.
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      mockConnectLookup.mockImplementation(
        (
          _host: string,
          options: { all?: boolean },
          cb: (e: null, a: unknown, f?: number) => void,
        ) =>
          options?.all
            ? cb(null, [{ address: '127.0.0.1', family: 4 }])
            : cb(null, '127.0.0.1', 4),
      );

      await expect(
        fetchLinkMetadata(`http://localhost:${port}/admin`),
      ).resolves.toBeNull();
      expect(requests).toBe(0);
    });

    it('connects to a name that stays public at connect time', async () => {
      requests = 0;
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const fetchSpy = jest.spyOn(undici, 'fetch').mockResolvedValue(
        new undici.Response('<title>Example</title>', {
          headers: { 'content-type': 'text/html' },
        }),
      );

      await expect(
        fetchLinkMetadata('https://example.com/'),
      ).resolves.toMatchObject({ title: 'Example' });
      // Every page fetch goes through the connect-time-checked dispatcher
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/',
        expect.objectContaining({ dispatcher: expect.any(undici.Agent) }),
      );
      fetchSpy.mockRestore();
    });
  });
});
