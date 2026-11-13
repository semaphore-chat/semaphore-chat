import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GifResultDto, GifSearchResponseDto } from '../dto/gif-response.dto';
import { GifProvider } from './gif-provider.interface';

const GIPHY_BASE_URL = 'https://api.giphy.com/v1/gifs';
const FETCH_TIMEOUT_MS = 5000;

// Giphy's `q` search param is capped at 50 characters — longer queries are
// truncated rather than rejected.
const MAX_QUERY_LENGTH = 50;

// Giphy's documented max `offset` per endpoint (paging past this returns no
// further results, so we treat it as pagination exhaustion).
const SEARCH_OFFSET_CAP = 4999;
const TRENDING_OFFSET_CAP = 499;

// Content rating ceiling applied to all GIF search/trending results. PG-13
// mirrors typical chat-app defaults for user-generated GIF content; kept as
// a single const so it's easy to change per-instance later.
const RATING = 'pg-13';

// Giphy serves GIF media from `media.giphy.com` and numbered CDN subdomains
// (`media0.giphy.com` …). Every URL we pass through to a client must be an
// https URL on one of those hosts; anything else is dropped rather than handed
// out for a client to fetch.
const GIPHY_MEDIA_HOSTNAME = /^media\d*\.giphy\.com$/i;

// Ceilings for the numeric rendition fields. Beyond these a value is treated
// as garbage (Giphy's sizes/dimensions are strings) instead of a real one, so
// a malformed response can't make a client reserve an absurd box or size.
const MAX_DIMENSION_PX = 100_000;
const MAX_RENDITION_BYTES = 1024 * 1024 * 1024; // 1 GiB

interface GiphyImageRendition {
  url: string;
  width: string;
  height: string;
  size?: string;
}

interface GiphyGifObject {
  id: string;
  title?: string;
  alt_text?: string;
  images?: {
    original?: GiphyImageRendition;
    fixed_height?: GiphyImageRendition;
    downsized?: GiphyImageRendition;
    downsized_medium?: GiphyImageRendition;
    [key: string]: GiphyImageRendition | undefined;
  };
}

/** One rendition of a GIF: the URL we offer plus whatever metadata is usable. */
interface OfferedRendition {
  url: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

interface GiphyPagination {
  offset?: number;
  count?: number;
  total_count?: number;
}

interface GiphyApiResponse {
  data?: GiphyGifObject[];
  pagination?: GiphyPagination;
}

/**
 * Giphy implementation of GifProvider. Proxies Giphy's /search and
 * /trending endpoints so the API key stays server-side, and adapts Giphy's
 * offset-based pagination to our opaque `pos` cursor string.
 */
@Injectable()
export class GiphyProvider implements GifProvider {
  private readonly logger = new Logger(GiphyProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async search(
    q: string,
    limit: number,
    pos?: string,
  ): Promise<GifSearchResponseDto> {
    const truncatedQ = (q ?? '').slice(0, MAX_QUERY_LENGTH);
    return this.fetchGiphy(
      'search',
      { q: truncatedQ, limit, pos },
      SEARCH_OFFSET_CAP,
    );
  }

  async featured(limit: number, pos?: string): Promise<GifSearchResponseDto> {
    return this.fetchGiphy('trending', { limit, pos }, TRENDING_OFFSET_CAP);
  }

  private async fetchGiphy(
    endpoint: 'search' | 'trending',
    params: { q?: string; limit: number; pos?: string },
    offsetCap: number,
  ): Promise<GifSearchResponseDto> {
    const apiKey = this.configService.get<string>('GIPHY_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GIF search is not configured on this instance. Set GIPHY_API_KEY in .env',
      );
    }

    const offset = this.decodeOffset(params.pos);

    const url = new URL(`${GIPHY_BASE_URL}/${endpoint}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('limit', String(params.limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('rating', RATING);
    if (params.q) url.searchParams.set('q', params.q);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        `Giphy ${endpoint} request failed: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Failed to reach the GIF service');
    }

    if (!response.ok) {
      this.logger.warn(`Giphy ${endpoint} returned HTTP ${response.status}`);
      throw new ServiceUnavailableException('Failed to reach the GIF service');
    }

    const data = (await response.json()) as GiphyApiResponse;

    const results = (data.data ?? [])
      .map((item) => this.mapResult(item))
      .filter((result): result is GifResultDto => result !== null);

    const pagination = data.pagination ?? {};
    const responseOffset = pagination.offset ?? offset;
    const count = pagination.count ?? 0;
    const next = this.computeNext(
      responseOffset,
      count,
      pagination.total_count,
      offsetCap,
    );

    return { results, next };
  }

  /**
   * Decodes our opaque `pos` cursor (a stringified Giphy `offset`) back into
   * a number. Missing, non-numeric, or negative values fall back to 0 (the
   * first page) rather than propagating a bad offset upstream.
   */
  private decodeOffset(pos?: string): number {
    if (!pos) return 0;
    const parsed = parseInt(pos, 10);
    if (Number.isNaN(parsed) || parsed < 0) return 0;
    return parsed;
  }

  /**
   * Computes the next-page cursor. Undefined (no further pages) when: the
   * page returned zero items, the known total has been exhausted, or the
   * next offset would exceed the endpoint's offset cap.
   */
  private computeNext(
    offset: number,
    count: number,
    totalCount: number | undefined,
    offsetCap: number,
  ): string | undefined {
    if (count === 0) return undefined;
    if (totalCount !== undefined && offset + count >= totalCount) {
      return undefined;
    }
    const nextOffset = offset + count;
    if (nextOffset > offsetCap) return undefined;
    return String(nextOffset);
  }

  /**
   * Maps a raw Giphy GIF object to our slim DTO. Returns null (filtered out
   * by the caller) when `images.original.url` is missing or not an https URL
   * on a Giphy media host, since we have no safe URL to render — mirrors the
   * previous Tenor null-skip pattern.
   *
   * `url`/`previewUrl`/`width`/`height` keep the shape earlier clients were
   * built against; the rendition fields alongside them describe the medium
   * and preview renditions (and the original's byte size) for clients that
   * want to pick the lighter one or reserve a box before it loads.
   */
  private mapResult(item: GiphyGifObject): GifResultDto | null {
    const images = item.images;
    const original = this.offerRendition(images?.original);
    if (!original) return null;

    // Medium: Giphy's downsized_medium, else its downsized, else the original
    // — whichever comes first is present and safe to load.
    const medium =
      this.offerRendition(images?.downsized_medium) ??
      this.offerRendition(images?.downsized) ??
      original;
    // The preview falls back to the original when fixed_height is missing or
    // unsafe, as it always has.
    const preview = this.offerRendition(images?.fixed_height) ?? original;

    return {
      id: item.id,
      title: item.title || item.alt_text || '',
      url: original.url,
      previewUrl: preview.url,
      width: original.width ?? 0,
      height: original.height ?? 0,
      mediumUrl: medium.url,
      mediumWidth: medium.width,
      mediumHeight: medium.height,
      mediumSizeBytes: medium.sizeBytes,
      originalSizeBytes: original.sizeBytes,
      previewWidth: preview.width,
      previewHeight: preview.height,
      previewSizeBytes: preview.sizeBytes,
    };
  }

  /**
   * Turns a raw rendition into one we may offer a client: undefined when the
   * URL is missing, not https, or on a host other than Giphy's media CDN.
   * Dimension and size fields are parsed defensively and omitted when unusable.
   */
  private offerRendition(
    rendition?: GiphyImageRendition,
  ): OfferedRendition | undefined {
    const url = this.allowedMediaUrl(rendition?.url);
    if (!url) return undefined;

    return {
      url,
      width: parseBoundedInt(rendition?.width, MAX_DIMENSION_PX),
      height: parseBoundedInt(rendition?.height, MAX_DIMENSION_PX),
      sizeBytes: parseBoundedInt(rendition?.size, MAX_RENDITION_BYTES),
    };
  }

  /** The URL unchanged when it is an https URL on a Giphy media host. */
  private allowedMediaUrl(value: unknown): string | undefined {
    if (typeof value !== 'string' || value === '') return undefined;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== 'https:') return undefined;
    if (!GIPHY_MEDIA_HOSTNAME.test(parsed.hostname)) return undefined;
    return value;
  }
}

/**
 * Parses one of Giphy's numeric string fields (`"220"`, `"1048576"`).
 * Missing, empty, signed, fractional, non-numeric, zero and above-`max`
 * values are absent — never NaN — so a client can treat "present" as usable.
 */
function parseBoundedInt(value: unknown, max: number): number | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    return undefined;
  }
  return parsed;
}
