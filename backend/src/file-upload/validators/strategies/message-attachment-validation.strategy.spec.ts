import { MessageAttachmentValidationStrategy } from './message-attachment-validation.strategy';

describe('MessageAttachmentValidationStrategy', () => {
  let strategy: MessageAttachmentValidationStrategy;

  beforeEach(() => {
    strategy = new MessageAttachmentValidationStrategy();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('getAllowedMimeTypes', () => {
    it('should return array of allowed MIME types', () => {
      const mimeTypes = strategy.getAllowedMimeTypes();

      expect(Array.isArray(mimeTypes)).toBe(true);
      expect(mimeTypes.length).toBeGreaterThan(0);
    });

    it('should include image MIME types', () => {
      const mimeTypes = strategy.getAllowedMimeTypes();

      expect(mimeTypes).toContain('image/jpeg');
      expect(mimeTypes).toContain('image/jpg');
      expect(mimeTypes).toContain('image/png');
      expect(mimeTypes).toContain('image/gif');
      expect(mimeTypes).toContain('image/webp');
      expect(mimeTypes).toContain('image/svg+xml');
    });

    it('should include video MIME types', () => {
      const mimeTypes = strategy.getAllowedMimeTypes();

      expect(mimeTypes).toContain('video/mp4');
      expect(mimeTypes).toContain('video/webm');
      expect(mimeTypes).toContain('video/ogg');
      expect(mimeTypes).toContain('video/quicktime');
      expect(mimeTypes).toContain('video/x-msvideo');
    });

    it('should include document MIME types', () => {
      const mimeTypes = strategy.getAllowedMimeTypes();

      expect(mimeTypes).toContain('application/pdf');
      expect(mimeTypes).toContain('application/msword');
      expect(mimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(mimeTypes).toContain('application/vnd.ms-excel');
      expect(mimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(mimeTypes).toContain('text/plain');
      expect(mimeTypes).toContain('text/csv');
    });

    it('should include archive MIME types', () => {
      const mimeTypes = strategy.getAllowedMimeTypes();

      expect(mimeTypes).toContain('application/zip');
      expect(mimeTypes).toContain('application/x-zip-compressed');
      expect(mimeTypes).toContain('application/vnd.rar');
      expect(mimeTypes).toContain('application/x-rar-compressed');
      expect(mimeTypes).toContain('application/x-7z-compressed');
      expect(mimeTypes).toContain('application/gzip');
      expect(mimeTypes).not.toContain('application/octet-stream');
    });

    it('should include audio MIME types', () => {
      const mimeTypes = strategy.getAllowedMimeTypes();

      expect(mimeTypes).toContain('audio/mpeg');
      expect(mimeTypes).toContain('audio/wav');
      expect(mimeTypes).toContain('audio/ogg');
      expect(mimeTypes).toContain('audio/webm');
      expect(mimeTypes).toContain('audio/aac');
    });

    it('should return all RAR variations', () => {
      const mimeTypes = strategy.getAllowedMimeTypes();

      expect(mimeTypes).toContain('application/vnd.rar');
      expect(mimeTypes).toContain('application/x-rar-compressed');
      expect(mimeTypes).toContain('application/x-rar');
      expect(mimeTypes).toContain('application/rar');
    });
  });

  describe('getMaxFileSize', () => {
    it('should return 500MB for video files', () => {
      const size = strategy.getMaxFileSize('video/mp4');

      expect(size).toBe(500 * 1024 * 1024);
    });

    it('should return 500MB for all video types', () => {
      expect(strategy.getMaxFileSize('video/webm')).toBe(500 * 1024 * 1024);
      expect(strategy.getMaxFileSize('video/ogg')).toBe(500 * 1024 * 1024);
      expect(strategy.getMaxFileSize('video/quicktime')).toBe(
        500 * 1024 * 1024,
      );
      expect(strategy.getMaxFileSize('video/x-msvideo')).toBe(
        500 * 1024 * 1024,
      );
      expect(strategy.getMaxFileSize('video/any')).toBe(500 * 1024 * 1024);
    });

    it('should return 25MB for image files', () => {
      const size = strategy.getMaxFileSize('image/jpeg');

      expect(size).toBe(25 * 1024 * 1024);
    });

    it('should return 25MB for all image types', () => {
      expect(strategy.getMaxFileSize('image/png')).toBe(25 * 1024 * 1024);
      expect(strategy.getMaxFileSize('image/gif')).toBe(25 * 1024 * 1024);
      expect(strategy.getMaxFileSize('image/webp')).toBe(25 * 1024 * 1024);
      expect(strategy.getMaxFileSize('image/svg+xml')).toBe(25 * 1024 * 1024);
      expect(strategy.getMaxFileSize('image/any')).toBe(25 * 1024 * 1024);
    });

    it('should return 50MB for audio files', () => {
      const size = strategy.getMaxFileSize('audio/mpeg');

      expect(size).toBe(50 * 1024 * 1024);
    });

    it('should return 50MB for all audio types', () => {
      expect(strategy.getMaxFileSize('audio/wav')).toBe(50 * 1024 * 1024);
      expect(strategy.getMaxFileSize('audio/ogg')).toBe(50 * 1024 * 1024);
      expect(strategy.getMaxFileSize('audio/webm')).toBe(50 * 1024 * 1024);
      expect(strategy.getMaxFileSize('audio/aac')).toBe(50 * 1024 * 1024);
      expect(strategy.getMaxFileSize('audio/any')).toBe(50 * 1024 * 1024);
    });

    it('should return 100MB for document files', () => {
      expect(strategy.getMaxFileSize('application/pdf')).toBe(
        100 * 1024 * 1024,
      );
      expect(strategy.getMaxFileSize('application/msword')).toBe(
        100 * 1024 * 1024,
      );
      expect(strategy.getMaxFileSize('text/plain')).toBe(100 * 1024 * 1024);
      expect(strategy.getMaxFileSize('text/csv')).toBe(100 * 1024 * 1024);
    });

    it('should return 100MB for archive files', () => {
      expect(strategy.getMaxFileSize('application/zip')).toBe(
        100 * 1024 * 1024,
      );
      expect(strategy.getMaxFileSize('application/vnd.rar')).toBe(
        100 * 1024 * 1024,
      );
      expect(strategy.getMaxFileSize('application/x-7z-compressed')).toBe(
        100 * 1024 * 1024,
      );
      expect(strategy.getMaxFileSize('application/gzip')).toBe(
        100 * 1024 * 1024,
      );
    });

    it('should return 100MB for unknown MIME types', () => {
      const size = strategy.getMaxFileSize('unknown/type');

      expect(size).toBe(100 * 1024 * 1024);
    });

    it('should handle empty MIME type', () => {
      const size = strategy.getMaxFileSize('');

      expect(size).toBe(100 * 1024 * 1024);
    });
  });

  describe('getValidationDescription', () => {
    it('should return description string', () => {
      const description = strategy.getValidationDescription();

      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
    });

    it('should mention different file types and their limits', () => {
      const description = strategy.getValidationDescription();

      expect(description).toContain('Images');
      expect(description).toContain('25MB');
      expect(description).toContain('Videos');
      expect(description).toContain('500MB');
      expect(description).toContain('100MB');
      expect(description).toContain('Audio');
      expect(description).toContain('50MB');
    });
  });
});
