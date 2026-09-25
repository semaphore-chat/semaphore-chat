import { ResourceType } from '@prisma/client';
import { ResourceTypeFileValidator } from './resource-type-file.validator';

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const GIF_HEADER = Buffer.from('GIF89a', 'ascii');
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);
// MZ header of a Windows executable
const EXE_HEADER = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
]);

/** Valid magic-byte content for each image MIME type used in tests. */
const VALID_IMAGE_CONTENT: Record<string, Buffer> = {
  'image/jpeg': JPEG_HEADER,
  'image/jpg': JPEG_HEADER,
  'image/png': PNG_HEADER,
  'image/gif': GIF_HEADER,
  'image/webp': WEBP_HEADER,
  'image/svg+xml': Buffer.from('<svg xmlns="ht', 'utf8'),
};

/**
 * Build a multer file. Image MIME types get matching magic-byte content by
 * default (overridable via `buffer`) so the content check passes.
 */
const makeFile = (
  overrides: Partial<Express.Multer.File>,
): Express.Multer.File => {
  const mimetype = overrides.mimetype ?? 'application/octet-stream';
  return {
    fieldname: 'file',
    originalname: 'test.bin',
    encoding: '7bit',
    mimetype,
    size: 1024,
    buffer: VALID_IMAGE_CONTENT[mimetype] ?? Buffer.from('test-content'),
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
};

describe('ResourceTypeFileValidator', () => {
  describe('MESSAGE_ATTACHMENT', () => {
    let validator: ResourceTypeFileValidator;

    beforeEach(() => {
      validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
    });

    it('should be defined', () => {
      expect(validator).toBeDefined();
    });

    it('should accept valid image file', async () => {
      const file = makeFile({
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 10 * 1024 * 1024, // 10MB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });

    it('should accept valid video file under limit', async () => {
      const file = makeFile({
        originalname: 'test.mp4',
        mimetype: 'video/mp4',
        size: 100 * 1024 * 1024, // 100MB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });

    it('should reject file with invalid MIME type', async () => {
      const file = makeFile({
        originalname: 'test.exe',
        mimetype: 'application/x-msdownload',
        size: 1024,
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should reject file exceeding size limit', async () => {
      const file = makeFile({
        originalname: 'test.mp4',
        mimetype: 'video/mp4',
        size: 600 * 1024 * 1024, // 600MB (over 500MB limit)
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should return false when file is undefined', async () => {
      const result = await validator.isValid(undefined);

      expect(result).toBe(false);
    });
  });

  describe('magic-byte content verification', () => {
    let validator: ResourceTypeFileValidator;

    beforeEach(() => {
      validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });
    });

    it('should reject a renamed executable claiming image/png', async () => {
      const file = makeFile({
        originalname: 'totally-a-picture.png',
        mimetype: 'image/png',
        buffer: EXE_HEADER,
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should reject an image whose content does not match its declared format', async () => {
      const file = makeFile({
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
        buffer: PNG_HEADER, // PNG content declared as JPEG
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should reject an image file whose content cannot be read', async () => {
      const file = makeFile({
        mimetype: 'image/png',
        buffer: Buffer.alloc(0),
        path: '',
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should accept each supported image format with matching content', async () => {
      for (const mimetype of [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
      ]) {
        const file = makeFile({ mimetype, size: 1024 });

        expect(await validator.isValid(file)).toBe(true);
      }
    });

    it('should not block non-image attachments with arbitrary content', async () => {
      const file = makeFile({
        originalname: 'archive.zip',
        mimetype: 'application/zip',
        buffer: EXE_HEADER, // arbitrary binary content is fine for non-images
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });
  });

  describe('USER_AVATAR', () => {
    let validator: ResourceTypeFileValidator;

    beforeEach(() => {
      validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.USER_AVATAR,
      });
    });

    it('should accept valid image file under 10MB', async () => {
      const file = makeFile({
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 5 * 1024 * 1024, // 5MB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });

    it('should reject image file over 10MB', async () => {
      const file = makeFile({
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 15 * 1024 * 1024, // 15MB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should reject non-image files', async () => {
      const file = makeFile({
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should reject a renamed executable claiming to be an avatar image', async () => {
      const file = makeFile({
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 1024,
        buffer: EXE_HEADER,
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });
  });

  describe('COMMUNITY_BANNER', () => {
    let validator: ResourceTypeFileValidator;

    beforeEach(() => {
      validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.COMMUNITY_BANNER,
      });
    });

    it('should accept valid image file under 25MB', async () => {
      const file = makeFile({
        originalname: 'banner.jpg',
        mimetype: 'image/jpeg',
        size: 20 * 1024 * 1024, // 20MB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });

    it('should reject image file over 25MB', async () => {
      const file = makeFile({
        originalname: 'banner.jpg',
        mimetype: 'image/jpeg',
        size: 30 * 1024 * 1024, // 30MB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });
  });

  describe('CUSTOM_EMOJI', () => {
    let validator: ResourceTypeFileValidator;

    beforeEach(() => {
      validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.CUSTOM_EMOJI,
      });
    });

    it('should accept valid PNG file under 256KB', async () => {
      const file = makeFile({
        originalname: 'emoji.png',
        mimetype: 'image/png',
        size: 100 * 1024, // 100KB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });

    it('should accept valid GIF file under 256KB', async () => {
      const file = makeFile({
        originalname: 'emoji.gif',
        mimetype: 'image/gif',
        size: 200 * 1024, // 200KB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });

    it('should reject file over 256KB', async () => {
      const file = makeFile({
        originalname: 'emoji.png',
        mimetype: 'image/png',
        size: 300 * 1024, // 300KB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });

    it('should reject JPEG files (not in allowed types)', async () => {
      const file = makeFile({
        originalname: 'emoji.jpg',
        mimetype: 'image/jpeg',
        size: 100 * 1024, // 100KB
      });

      const result = await validator.isValid(file);

      expect(result).toBe(false);
    });
  });

  describe('buildErrorMessage', () => {
    it('should build error message for invalid MIME type', () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.USER_AVATAR,
      });

      const file = makeFile({
        originalname: 'document.pdf',
        mimetype: 'application/pdf',
        size: 1024,
      });

      const message = validator.buildErrorMessage(file);

      expect(message).toContain('Invalid file type');
      expect(message).toContain('Images only');
    });

    it('should build error message for file too large', () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.USER_AVATAR,
      });

      const file = makeFile({
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 15 * 1024 * 1024, // 15MB (over 10MB limit)
      });

      const message = validator.buildErrorMessage(file);

      expect(message).toContain('File too large');
      expect(message).toContain('15.00MB');
      expect(message).toContain('10.00MB');
      expect(message).toContain('USER_AVATAR');
    });

    it('should build error message for content/MIME mismatch after failed validation', async () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.USER_AVATAR,
      });

      const file = makeFile({
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 1024,
        buffer: EXE_HEADER,
      });

      expect(await validator.isValid(file)).toBe(false);

      const message = validator.buildErrorMessage(file);

      expect(message).toContain('does not match the declared type');
      expect(message).toContain('image/png');
    });

    it('should build error message for invalid resource type', () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: 'INVALID_TYPE' as never,
      });

      const file = makeFile({
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
      });

      const message = validator.buildErrorMessage(file);

      expect(message).toContain('Invalid resource type');
      expect(message).toContain('INVALID_TYPE');
    });

    it('should include validation description in error message', () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.MESSAGE_ATTACHMENT,
      });

      const file = makeFile({
        originalname: 'test.exe',
        mimetype: 'application/x-msdownload',
        size: 1024,
      });

      const message = validator.buildErrorMessage(file);

      expect(message).toContain('Invalid file type');
    });
  });

  describe('edge cases', () => {
    it('should handle null file', async () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.USER_AVATAR,
      });

      const result = await validator.isValid(null as never);

      expect(result).toBe(false);
    });

    it('should use correct strategy for USER_BANNER', async () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.USER_BANNER,
      });

      const file = makeFile({
        originalname: 'banner.png',
        mimetype: 'image/png',
        size: 5 * 1024 * 1024, // 5MB (under 10MB limit for UserAvatarStrategy)
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });

    it('should use correct strategy for COMMUNITY_AVATAR', async () => {
      const validator = new ResourceTypeFileValidator({
        resourceType: ResourceType.COMMUNITY_AVATAR,
      });

      const file = makeFile({
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 20 * 1024 * 1024, // 20MB (under 25MB limit for CommunityBannerStrategy)
      });

      const result = await validator.isValid(file);

      expect(result).toBe(true);
    });
  });
});
