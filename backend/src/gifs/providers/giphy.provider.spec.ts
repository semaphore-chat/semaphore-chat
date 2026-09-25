import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { GiphyProvider } from './giphy.provider';

describe('GiphyProvider', () => {
  let provider: GiphyProvider;
  let configService: Mocked<ConfigService>;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(GiphyProvider).compile();

    provider = unit;
    configService = unitRef.get(ConfigService);
    configService.get.mockReturnValue('test-giphy-key');

    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function mockFetchResponse(body: unknown, ok = true, status = 200) {
    fetchSpy.mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    });
  }

  describe('key-absent path', () => {
    it('throws ServiceUnavailableException from search mentioning GIPHY_API_KEY when unconfigured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(provider.search('cats', 20)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(provider.search('cats', 20)).rejects.toThrow(
        /GIPHY_API_KEY/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailableException from featured when GIPHY_API_KEY is not configured', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(provider.featured(20)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('search request params', () => {
    it('passes api_key, q, limit, offset (from pos) and rating', async () => {
      mockFetchResponse({ data: [], pagination: { offset: 5, count: 0 } });

      await provider.search('dogs', 15, '5');

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.origin + calledUrl.pathname).toBe(
        'https://api.giphy.com/v1/gifs/search',
      );
      expect(calledUrl.searchParams.get('api_key')).toBe('test-giphy-key');
      expect(calledUrl.searchParams.get('q')).toBe('dogs');
      expect(calledUrl.searchParams.get('limit')).toBe('15');
      expect(calledUrl.searchParams.get('offset')).toBe('5');
      expect(calledUrl.searchParams.get('rating')).toBe('pg-13');
    });

    it('truncates queries longer than 50 characters', async () => {
      mockFetchResponse({ data: [] });

      const longQuery = 'a'.repeat(80);
      await provider.search(longQuery, 20);

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('q')).toBe('a'.repeat(50));
    });

    it('decodes an invalid (non-numeric) pos as offset 0', async () => {
      mockFetchResponse({ data: [] });

      await provider.search('cats', 20, 'not-a-number');

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('offset')).toBe('0');
    });

    it('decodes a negative pos as offset 0', async () => {
      mockFetchResponse({ data: [] });

      await provider.search('cats', 20, '-5');

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('offset')).toBe('0');
    });

    it('defaults offset to 0 when pos is absent', async () => {
      mockFetchResponse({ data: [] });

      await provider.search('cats', 20);

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('offset')).toBe('0');
    });
  });

  describe('featured (trending) request params', () => {
    it('hits the trending endpoint without a q param', async () => {
      mockFetchResponse({ data: [], pagination: { offset: 0, count: 0 } });

      await provider.featured(10, '20');

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.origin + calledUrl.pathname).toBe(
        'https://api.giphy.com/v1/gifs/trending',
      );
      expect(calledUrl.searchParams.has('q')).toBe(false);
      expect(calledUrl.searchParams.get('offset')).toBe('20');
      expect(calledUrl.searchParams.get('rating')).toBe('pg-13');
    });
  });

  describe('response mapping', () => {
    it('maps Giphy results to the slim DTO shape, parsing string dims', async () => {
      mockFetchResponse({
        data: [
          {
            id: 'gif-1',
            title: 'Cat jumping',
            images: {
              original: {
                url: 'https://media.giphy.com/1/cat.gif',
                width: '220',
                height: '140',
              },
              fixed_height: {
                url: 'https://media.giphy.com/1/cat-fh.gif',
                width: '200',
                height: '200',
              },
            },
          },
        ],
        pagination: { offset: 0, count: 1, total_count: 100 },
      });

      const result = await provider.search('cat', 20);

      expect(result.results).toEqual([
        {
          id: 'gif-1',
          title: 'Cat jumping',
          url: 'https://media.giphy.com/1/cat.gif',
          previewUrl: 'https://media.giphy.com/1/cat-fh.gif',
          width: 220,
          height: 140,
        },
      ]);
    });

    it('falls back to alt_text when title is absent', async () => {
      mockFetchResponse({
        data: [
          {
            id: 'gif-2',
            alt_text: 'A dog running',
            images: {
              original: {
                url: 'https://media.giphy.com/2/dog.gif',
                width: '100',
                height: '100',
              },
            },
          },
        ],
        pagination: { offset: 0, count: 1 },
      });

      const result = await provider.search('dog', 20);

      expect(result.results[0].title).toBe('A dog running');
    });

    it('defaults title to an empty string when both title and alt_text are absent', async () => {
      mockFetchResponse({
        data: [
          {
            id: 'gif-2b',
            images: {
              original: {
                url: 'https://media.giphy.com/2b/nada.gif',
                width: '10',
                height: '10',
              },
            },
          },
        ],
        pagination: { offset: 0, count: 1 },
      });

      const result = await provider.search('nada', 20);

      expect(result.results[0].title).toBe('');
    });

    it('skips results missing images.original.url', async () => {
      mockFetchResponse({
        data: [
          {
            id: 'gif-3',
            images: {
              fixed_height: {
                url: 'https://media.giphy.com/3/tiny.gif',
                width: '50',
                height: '50',
              },
            },
          },
          {
            id: 'gif-4',
            images: {
              original: {
                url: 'https://media.giphy.com/4/full.gif',
                width: '100',
                height: '100',
              },
            },
          },
        ],
        pagination: { offset: 0, count: 2 },
      });

      const result = await provider.search('missing', 20);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('gif-4');
    });

    it('falls back to the original url as previewUrl when fixed_height is missing', async () => {
      mockFetchResponse({
        data: [
          {
            id: 'gif-5',
            images: {
              original: {
                url: 'https://media.giphy.com/5/full.gif',
                width: '50',
                height: '60',
              },
            },
          },
        ],
        pagination: { offset: 0, count: 1 },
      });

      const result = await provider.search('no-fh', 20);

      expect(result.results[0].previewUrl).toBe(
        'https://media.giphy.com/5/full.gif',
      );
    });

    it('defaults width/height to 0 when dims are missing or unparseable', async () => {
      mockFetchResponse({
        data: [
          {
            id: 'gif-6',
            images: {
              original: {
                url: 'https://media.giphy.com/6/full.gif',
                width: 'not-a-number',
              },
            },
          },
        ],
        pagination: { offset: 0, count: 1 },
      });

      const result = await provider.search('no-dims', 20);

      expect(result.results[0].width).toBe(0);
      expect(result.results[0].height).toBe(0);
    });

    it('returns an empty results array when Giphy returns no data field', async () => {
      mockFetchResponse({});

      const result = await provider.search('nothing', 20);

      expect(result.results).toEqual([]);
    });
  });

  describe('pagination next cursor', () => {
    it('advances next to offset + count on a normal page', async () => {
      mockFetchResponse({
        data: [],
        pagination: { offset: 0, count: 25, total_count: 500 },
      });

      const result = await provider.search('cats', 25);

      expect(result.next).toBe('25');
    });

    it('is undefined when count is 0', async () => {
      mockFetchResponse({
        data: [],
        pagination: { offset: 40, count: 0, total_count: 40 },
      });

      const result = await provider.search('cats', 25, '40');

      expect(result.next).toBeUndefined();
    });

    it('is undefined when total_count is exhausted', async () => {
      mockFetchResponse({
        data: [],
        pagination: { offset: 480, count: 20, total_count: 500 },
      });

      const result = await provider.search('cats', 25, '480');

      expect(result.next).toBeUndefined();
    });

    it('is defined when total_count is not yet exhausted', async () => {
      mockFetchResponse({
        data: [],
        pagination: { offset: 480, count: 20, total_count: 501 },
      });

      const result = await provider.search('cats', 25, '480');

      expect(result.next).toBe('500');
    });

    it('is undefined when the next offset would exceed the search offset cap (4999)', async () => {
      mockFetchResponse({
        data: [],
        pagination: { offset: 4980, count: 25 },
      });

      const result = await provider.search('cats', 25, '4980');

      expect(result.next).toBeUndefined();
    });

    it('is undefined when the next offset would exceed the trending offset cap (499)', async () => {
      mockFetchResponse({
        data: [],
        pagination: { offset: 490, count: 15 },
      });

      const result = await provider.featured(15, '490');

      expect(result.next).toBeUndefined();
    });

    it('is defined when within the trending offset cap', async () => {
      mockFetchResponse({
        data: [],
        pagination: { offset: 100, count: 15 },
      });

      const result = await provider.featured(15, '100');

      expect(result.next).toBe('115');
    });
  });

  describe('error handling', () => {
    it('throws ServiceUnavailableException when Giphy responds with a non-OK status', async () => {
      mockFetchResponse({}, false, 502);

      await expect(provider.search('cat', 20)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when the fetch itself rejects (network/timeout)', async () => {
      fetchSpy.mockRejectedValue(new Error('timed out'));

      await expect(provider.search('cat', 20)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('sends a 5s AbortSignal timeout with the request', async () => {
      mockFetchResponse({ data: [] });

      await provider.search('cat', 20);

      const options = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
