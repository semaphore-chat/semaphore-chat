import { IFileValidationStrategy } from './file-validation-strategy.interface';

/**
 * Validation strategy for community banners and avatars
 * Images only, medium size limit
 */
export class CommunityBannerValidationStrategy implements IFileValidationStrategy {
  private readonly MAX_SIZE = 25 * 1024 * 1024; // 25MB

  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  getAllowedMimeTypes(): string[] {
    return this.allowedMimeTypes;
  }

  getMaxFileSize(): number {
    return this.MAX_SIZE;
  }

  getValidationDescription(): string {
    return 'Images only (JPEG, PNG, GIF, WebP), max 25MB';
  }
}
