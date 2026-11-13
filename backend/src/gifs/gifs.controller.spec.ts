import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { GifsController } from './gifs.controller';
import { GifsService } from './gifs.service';

describe('GifsController', () => {
  let controller: GifsController;
  let service: Mocked<GifsService>;

  const mockResponse = {
    results: [
      {
        id: 'gif-1',
        title: 'Cat',
        url: 'https://media.giphy.com/1/cat.gif',
        previewUrl: 'https://media.giphy.com/1/cat-tiny.gif',
        width: 220,
        height: 140,
        mediumUrl: 'https://media.giphy.com/1/cat-medium.gif',
        mediumWidth: 160,
        mediumHeight: 102,
        mediumSizeBytes: 1048576,
        originalSizeBytes: 5242880,
        previewWidth: 100,
        previewHeight: 64,
        previewSizeBytes: 262144,
      },
    ],
    next: 'cursor-1',
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(GifsController).compile();

    controller = unit;
    service = unitRef.get(GifsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('applies JwtAuthGuard at the controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, GifsController);
    expect(guards).toContain(JwtAuthGuard);
  });

  describe('search', () => {
    it('forwards q, limit, and pos to the service', async () => {
      service.search.mockResolvedValue(mockResponse);

      const result = await controller.search('cats', {
        limit: 20,
        pos: 'cursor-0',
      });

      expect(service.search).toHaveBeenCalledWith('cats', 20, 'cursor-0');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('featured', () => {
    it('forwards limit and pos to the service', async () => {
      service.featured.mockResolvedValue(mockResponse);

      const result = await controller.featured({ limit: 15, pos: 'cursor-2' });

      expect(service.featured).toHaveBeenCalledWith(15, 'cursor-2');
      expect(result).toEqual(mockResponse);
    });

    it('forwards a result with no rendition metadata as-is', async () => {
      const bare = {
        results: [
          {
            id: 'gif-2',
            title: '',
            url: 'https://media.giphy.com/2/gif.gif',
            previewUrl: 'https://media.giphy.com/2/gif.gif',
            width: 0,
            height: 0,
          },
        ],
      };
      service.featured.mockResolvedValue(bare);

      await expect(controller.featured({ limit: 20 })).resolves.toEqual(bare);
    });
  });
});
