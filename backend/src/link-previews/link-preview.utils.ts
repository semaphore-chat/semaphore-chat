import {
  isPrivateIp,
  isPublicUrl,
  publicOnlyLookup,
} from '@/common/utils/public-address.util';
import { Agent, fetch, type Response } from 'undici';

export { isPrivateIp, isPublicUrl };

/**
 * Every link-preview request connects through this agent, whose lookup
 * refuses non-public addresses at connection time. `isPublicUrl` alone checks
 * one DNS answer and the connection makes another, so a name answering a
 * public address first and an internal one next (DNS rebinding) would pass.
 */
const publicOnlyDispatcher = new Agent({
  connect: { lookup: publicOnlyLookup },
});

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  faviconUrl?: string;
  authorName?: string;
}

const URL_PATTERN = /(https?:\/\/[^\s<>)"']*[^\s<>)"'.,!?;:])/g;
const MAX_URLS_PER_MESSAGE = 5;

/**
 * Extract unique URLs from text, limited to MAX_URLS_PER_MESSAGE.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  const unique = [...new Set(matches)];
  return unique.slice(0, MAX_URLS_PER_MESSAGE);
}

/**
 * Parse Open Graph meta tags from an HTML string.
 * Uses regex — no DOM parser dependency needed.
 */
export function parseOpenGraphTags(
  html: string,
  baseUrl: string,
): Partial<LinkPreviewData> {
  const result: Partial<LinkPreviewData> = {};

  // Extract og: meta tags (property or name attribute)
  // Captures colon-separated variants like og:image:secure_url
  const metaPattern =
    /<meta\s+[^>]*(?:property|name)\s*=\s*["']og:([\w:]+)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*\/?>/gi;
  const metaPatternReverse =
    /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']og:([\w:]+)["'][^>]*\/?>/gi;

  const ogTags: Record<string, string> = {};

  let match: RegExpExecArray | null;
  while ((match = metaPattern.exec(html)) !== null) {
    ogTags[match[1].toLowerCase()] = match[2];
  }
  while ((match = metaPatternReverse.exec(html)) !== null) {
    ogTags[match[2].toLowerCase()] = match[1];
  }

  if (ogTags['title']) result.title = ogTags['title'];
  if (ogTags['description']) result.description = ogTags['description'];
  // og:image with fallback to og:image:secure_url and og:image:url
  const ogImage =
    ogTags['image'] || ogTags['image:secure_url'] || ogTags['image:url'];
  if (ogImage) result.imageUrl = resolveUrl(ogImage, baseUrl);
  if (ogTags['site_name']) result.siteName = ogTags['site_name'];

  // Fallback: <title> tag
  if (!result.title) {
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    if (titleMatch) result.title = titleMatch[1].trim();
  }

  // Fallback: <meta name="description"> (non-OG)
  if (!result.description) {
    const descPattern =
      /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*\/?>/i;
    const descMatch = descPattern.exec(html);
    if (descMatch) result.description = descMatch[1];
  }

  // Favicon
  const faviconPattern =
    /<link\s+[^>]*rel\s*=\s*["'](?:shortcut )?icon["'][^>]*href\s*=\s*["']([^"']*)["'][^>]*\/?>/i;
  const faviconMatch = faviconPattern.exec(html);
  if (faviconMatch) {
    result.faviconUrl = resolveUrl(faviconMatch[1], baseUrl);
  }

  return result;
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

/**
 * Sanitize a link preview: strip HTML, truncate fields, validate URLs.
 */
export function sanitizePreview(
  preview: Partial<LinkPreviewData>,
): Partial<LinkPreviewData> {
  const sanitized: Partial<LinkPreviewData> = {};

  if (preview.title) {
    sanitized.title = stripHtml(preview.title).slice(0, 200);
  }
  if (preview.description) {
    sanitized.description = stripHtml(preview.description).slice(0, 300);
  }
  if (preview.imageUrl && isValidHttpUrl(preview.imageUrl)) {
    sanitized.imageUrl = preview.imageUrl;
  }
  if (preview.siteName) {
    sanitized.siteName = stripHtml(preview.siteName).slice(0, 100);
  }
  if (preview.faviconUrl && isValidHttpUrl(preview.faviconUrl)) {
    sanitized.faviconUrl = preview.faviconUrl;
  }
  if (preview.authorName) {
    sanitized.authorName = stripHtml(preview.authorName).slice(0, 100);
  }

  return sanitized;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// oEmbed support — supplementary data source alongside OG tags
// ---------------------------------------------------------------------------

interface OEmbedProvider {
  patterns: RegExp[];
  endpoint: string;
}

/**
 * Hard-coded top oEmbed providers that return useful thumbnail/metadata.
 * Only providers whose oEmbed responses include thumbnail_url are listed —
 * providers that only return embed HTML (Reddit, Twitter) are excluded since
 * OG tags give better card data for those.
 */
const OEMBED_PROVIDERS: OEmbedProvider[] = [
  {
    // YouTube
    patterns: [
      /^https?:\/\/(?:www\.)?youtube\.com\/watch/,
      /^https?:\/\/youtu\.be\//,
      /^https?:\/\/(?:www\.)?youtube\.com\/shorts\//,
    ],
    endpoint: 'https://www.youtube.com/oembed',
  },
  {
    // Vimeo
    patterns: [/^https?:\/\/(?:www\.)?vimeo\.com\/\d+/],
    endpoint: 'https://vimeo.com/api/oembed.json',
  },
  {
    // Spotify
    patterns: [/^https?:\/\/open\.spotify\.com\//],
    endpoint: 'https://open.spotify.com/oembed',
  },
  {
    // SoundCloud
    patterns: [/^https?:\/\/soundcloud\.com\//],
    endpoint: 'https://soundcloud.com/oembed',
  },
  {
    // Flickr
    patterns: [
      /^https?:\/\/(?:www\.)?flickr\.com\/photos\//,
      /^https?:\/\/flic\.kr\//,
    ],
    endpoint: 'https://www.flickr.com/services/oembed/',
  },
  {
    // TikTok
    patterns: [/^https?:\/\/(?:www\.)?tiktok\.com\//],
    endpoint: 'https://www.tiktok.com/oembed',
  },
];

interface OEmbedResponse {
  type?: string;
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

/**
 * Find an oEmbed provider for a URL. Returns null if no provider matches.
 */
export function findOEmbedProvider(url: string): OEmbedProvider | null {
  for (const provider of OEMBED_PROVIDERS) {
    if (provider.patterns.some((p) => p.test(url))) {
      return provider;
    }
  }
  return null;
}

/**
 * Fetch oEmbed data for a URL from a known provider endpoint.
 * Returns null on failure — never throws.
 */
export async function fetchOEmbed(
  url: string,
  provider: OEmbedProvider,
): Promise<OEmbedResponse | null> {
  try {
    const oembedUrl = `${provider.endpoint}?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      dispatcher: publicOnlyDispatcher,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as OEmbedResponse;
  } catch {
    return null;
  }
}

/**
 * Merge oEmbed data into a link preview, filling gaps.
 * oEmbed thumbnail_url wins over OG image when available (typically higher quality).
 * OG description is kept since oEmbed doesn't provide one.
 */
export function mergeOEmbedData(
  preview: Partial<LinkPreviewData>,
  oembed: OEmbedResponse,
): Partial<LinkPreviewData> {
  return {
    ...preview,
    // oEmbed thumbnail is usually higher quality than og:image
    imageUrl: oembed.thumbnail_url || preview.imageUrl,
    // oEmbed title as fallback
    title: preview.title || oembed.title,
    // provider_name as fallback for site name
    siteName: preview.siteName || oembed.provider_name,
    // author_name is oEmbed-only data
    authorName: oembed.author_name || preview.authorName,
  };
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

const MAX_BODY_SIZE = 50 * 1024; // 50KB
const FETCH_TIMEOUT_MS = 5000;

const FETCH_HEADERS = {
  'User-Agent':
    'SemaphoreChatBot/1.0 (+https://semaphorechat.app/bot; like Discordbot)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate',
  Connection: 'keep-alive',
};

/**
 * Fetch link preview metadata from a URL.
 * Uses OG tags as the primary source, enriched with oEmbed data when a
 * known provider matches (YouTube, Spotify, Vimeo, etc.).
 * Returns null if the fetch fails or yields no useful metadata.
 */
export async function fetchLinkMetadata(
  url: string,
): Promise<LinkPreviewData | null> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  // SSRF protection
  const safe = await isPublicUrl(parsedUrl.hostname);
  if (!safe) return null;

  // Check if a known oEmbed provider matches this URL
  const oembedProvider = findOEmbedProvider(url);

  try {
    // Fetch OG tags and oEmbed in parallel when a provider exists
    const [ogResult, oembedResult] = await Promise.all([
      fetchOgTags(url, parsedUrl),
      oembedProvider ? fetchOEmbed(url, oembedProvider) : null,
    ]);

    // Start with OG data (primary source for cards)
    let preview = ogResult ?? {};

    // Merge oEmbed data if available (better thumbnails, author info)
    if (oembedResult) {
      preview = mergeOEmbedData(preview, oembedResult);
    }

    const sanitized = sanitizePreview(preview);

    // Must have at least a title to be useful
    if (!sanitized.title) return null;

    return { url, ...sanitized };
  } catch {
    return null;
  }
}

const MAX_REDIRECTS = 5;

/**
 * Follow redirects manually, validating each hop's destination against SSRF.
 * Returns the final Response or null if blocked/failed.
 */
async function fetchWithRedirectValidation(
  url: string,
  signal: AbortSignal,
): Promise<Response | null> {
  let currentUrl = url;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl, {
      dispatcher: publicOnlyDispatcher,
      signal,
      redirect: 'manual',
      headers: FETCH_HEADERS,
    });

    // Not a redirect — return the response
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    // Handle redirect: validate destination before following
    const location = response.headers.get('location');
    if (!location) return null;

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return null;
    }

    // Only follow http/https redirects
    if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
      return null;
    }

    // SSRF check on redirect destination
    const safe = await isPublicUrl(nextUrl.hostname);
    if (!safe) return null;

    currentUrl = nextUrl.href;
  }

  // Too many redirects
  return null;
}

/**
 * Fetch and parse OG tags from an HTML page.
 * Separated from fetchLinkMetadata to allow parallel oEmbed fetching.
 */
async function fetchOgTags(
  url: string,
  parsedUrl: URL,
): Promise<Partial<LinkPreviewData> | null> {
  try {
    const response = await fetchWithRedirectValidation(
      url,
      AbortSignal.timeout(FETCH_TIMEOUT_MS),
    );

    if (!response) return null;

    // Detect Cloudflare challenge responses via official cf-mitigated header
    // See: https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/
    if (response.headers.get('cf-mitigated') === 'challenge') return null;

    // Cloudflare 403/503 with server: cloudflare is a bot block
    const isCloudflare = response.headers
      .get('server')
      ?.toLowerCase()
      .includes('cloudflare');
    if (isCloudflare && (response.status === 403 || response.status === 503)) {
      return null;
    }

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';

    // Direct image URL — set hostname as title so the preview isn't discarded
    if (contentType.startsWith('image/')) {
      return {
        title: parsedUrl.pathname.split('/').pop() || parsedUrl.hostname,
        imageUrl: url,
        siteName: parsedUrl.hostname,
      };
    }

    // Only parse HTML
    if (!contentType.includes('text/html')) return null;

    // Read limited body
    // undici types its body as a stream of `any`; fetch bodies are bytes
    const reader = (
      response.body as ReadableStream<Uint8Array> | null
    )?.getReader();
    if (!reader) return null;

    let html = '';
    let bytesRead = 0;
    const decoder = new TextDecoder();

    while (bytesRead < MAX_BODY_SIZE) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      html += decoder.decode(value, { stream: true });
    }
    void reader.cancel();

    // Detect challenge pages by body content (Cloudflare JS challenge fingerprint)
    if (
      html.includes('cf-browser-verification') ||
      html.includes('challenges.cloudflare.com')
    ) {
      return null;
    }

    return parseOpenGraphTags(html, url);
  } catch {
    return null;
  }
}
