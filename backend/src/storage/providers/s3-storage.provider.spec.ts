import { TestBed } from '@suites/unit';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { S3StorageProvider } from './s3-storage.provider';

// Hand-mock the AWS SDK: no aws-sdk-client-mock dependency in this repo, and
// the provider's whole contract with the SDK is "construct a client, call
// .send(command)" — trivial to fake directly.
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((config: unknown) => ({
    send: mockSend,
    __config: config,
  })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ __type: 'GetObject', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input: unknown) => ({
    __type: 'DeleteObject',
    input,
  })),
  HeadObjectCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ __type: 'HeadObject', input })),
}));

const mockUploadDone = jest.fn();
const mockUploadCtor = jest.fn();
let progressListener:
  ((progress: { loaded?: number; total?: number }) => void) | undefined;

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation((opts: unknown) => {
    mockUploadCtor(opts);
    return {
      on: jest.fn(
        (
          event: string,
          listener: (progress: { loaded?: number; total?: number }) => void,
        ) => {
          if (event === 'httpUploadProgress') {
            progressListener = listener;
          }
        },
      ),
      done: mockUploadDone,
    };
  }),
}));

describe('S3StorageProvider', () => {
  let provider: S3StorageProvider;

  const envValues: Record<string, string | undefined> = {
    S3_BUCKET: 'test-bucket',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'AKIA_TEST',
    S3_SECRET_ACCESS_KEY: 'secret',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    progressListener = undefined;

    const { unit } = await TestBed.solitary(S3StorageProvider)
      .mock(ConfigService)
      .final({
        get: jest.fn((key: string) => envValues[key]),
      })
      .compile();

    provider = unit;
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('writeStream', () => {
    it('streams via lib-storage Upload (never buffers the whole object)', async () => {
      // Simulate lib-storage's own httpUploadProgress accounting — the
      // provider must derive `size` from this, never from a follow-up
      // HeadObject call (mockSend is intentionally left unstubbed here to
      // prove writeStream never calls `client.send` at all).
      mockUploadDone.mockImplementation(() => {
        progressListener?.({ loaded: 4096, total: 4096 });
        return Promise.resolve({ ETag: '"abc123"' });
      });
      const source = Readable.from([Buffer.from('chunk')]);

      const result = await provider.writeStream('uploads/key.png', source, {
        contentType: 'image/png',
      });

      expect(mockUploadCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: 'uploads/key.png',
            Body: source,
            ContentType: 'image/png',
          }),
        }),
      );
      expect(mockUploadDone).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
      expect(result).toEqual({ size: 4096, etag: '"abc123"' });
    });

    it('defaults size to 0 when lib-storage never reports upload progress', async () => {
      mockUploadDone.mockResolvedValue({ ETag: '"abc123"' });
      const source = Readable.from([Buffer.from('chunk')]);

      const result = await provider.writeStream('uploads/key.png', source);

      expect(result).toEqual({ size: 0, etag: '"abc123"' });
    });

    it('propagates upload errors', async () => {
      mockUploadDone.mockRejectedValue(new Error('network error'));
      const source = Readable.from([Buffer.from('chunk')]);

      await expect(
        provider.writeStream('uploads/key.png', source),
      ).rejects.toThrow('network error');
    });
  });

  describe('getReadStream', () => {
    it('returns the response Body for a full read (no Range)', async () => {
      const body = Readable.from([Buffer.from('data')]);
      mockSend.mockResolvedValue({ Body: body });

      const result = await provider.getReadStream('uploads/key.png');

      expect(result).toBe(body);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          __type: 'GetObject',
          input: { Bucket: 'test-bucket', Key: 'uploads/key.png' },
        }),
      );
    });

    it('passes a Range header for ranged reads (RFC 7233 bytes=start-end)', async () => {
      const body = Readable.from([Buffer.from('data')]);
      mockSend.mockResolvedValue({ Body: body });

      await provider.getReadStream('uploads/key.png', { start: 0, end: 999 });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ Range: 'bytes=0-999' }),
        }),
      );
    });

    it('throws when the response has no readable Body', async () => {
      mockSend.mockResolvedValue({ Body: undefined });

      await expect(
        provider.getReadStream('uploads/missing.png'),
      ).rejects.toThrow(/no readable body/);
    });

    it('propagates errors from the SDK', async () => {
      mockSend.mockRejectedValue(new Error('access denied'));

      await expect(provider.getReadStream('uploads/key.png')).rejects.toThrow(
        'access denied',
      );
    });
  });

  describe('deleteFile', () => {
    it('sends a DeleteObjectCommand for the bucket/key', async () => {
      mockSend.mockResolvedValue({});

      await provider.deleteFile('uploads/key.png');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          __type: 'DeleteObject',
          input: { Bucket: 'test-bucket', Key: 'uploads/key.png' },
        }),
      );
    });

    it('propagates errors', async () => {
      mockSend.mockRejectedValue(new Error('bucket unreachable'));

      await expect(provider.deleteFile('uploads/key.png')).rejects.toThrow(
        'bucket unreachable',
      );
    });
  });

  describe('fileExists', () => {
    it('returns true when HeadObject succeeds', async () => {
      mockSend.mockResolvedValue({ ContentLength: 10 });

      await expect(provider.fileExists('uploads/key.png')).resolves.toBe(true);
    });

    it('returns false when HeadObject reports NotFound by name', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('not found'), {
          name: 'NotFound',
        }),
      );

      await expect(provider.fileExists('uploads/missing.png')).resolves.toBe(
        false,
      );
    });

    it('returns false when HeadObject reports a 404 status', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('not found'), {
          $metadata: { httpStatusCode: 404 },
        }),
      );

      await expect(provider.fileExists('uploads/missing.png')).resolves.toBe(
        false,
      );
    });

    it('re-throws non-NotFound errors', async () => {
      mockSend.mockRejectedValue(new Error('access denied'));

      await expect(provider.fileExists('uploads/key.png')).rejects.toThrow(
        'access denied',
      );
    });
  });

  describe('getFileStats', () => {
    it('maps HeadObject fields to FileStats', async () => {
      const lastModified = new Date('2026-02-02T00:00:00Z');
      mockSend.mockResolvedValue({
        ContentLength: 12345,
        LastModified: lastModified,
        ContentType: 'video/mp4',
        ETag: '"deadbeef"',
      });

      const result = await provider.getFileStats('uploads/video.mp4');

      expect(result).toEqual({
        size: 12345,
        mtime: lastModified,
        ctime: lastModified,
        contentType: 'video/mp4',
        etag: '"deadbeef"',
      });
    });

    it('defaults size to 0 and dates to epoch when fields are missing', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.getFileStats('uploads/video.mp4');

      expect(result.size).toBe(0);
      expect(result.mtime).toEqual(new Date(0));
      expect(result.ctime).toEqual(new Date(0));
    });

    it('propagates errors', async () => {
      mockSend.mockRejectedValue(new Error('access denied'));

      await expect(provider.getFileStats('uploads/key.png')).rejects.toThrow(
        'access denied',
      );
    });
  });

  describe('getFileUrl', () => {
    it('returns the key as-is (presigned URLs are not wired into any serve path in this task)', async () => {
      await expect(provider.getFileUrl('uploads/key.png')).resolves.toBe(
        'uploads/key.png',
      );
    });
  });
});
