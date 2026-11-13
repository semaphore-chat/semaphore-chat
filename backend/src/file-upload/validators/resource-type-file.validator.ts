import { FileValidator } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import {
  IFileValidationStrategy,
  MessageAttachmentValidationStrategy,
  UserAvatarValidationStrategy,
  CommunityBannerValidationStrategy,
  CustomEmojiValidationStrategy,
  SoundboardSoundValidationStrategy,
} from './strategies';
import { matchesDeclaredMediaType, readFileHeader } from './magic-bytes.util';

interface ResourceTypeFileValidatorOptions {
  resourceType: ResourceType;
}

/**
 * Custom file validator that uses strategy pattern to validate files
 * based on their ResourceType without switch statements
 */
export class ResourceTypeFileValidator extends FileValidator<ResourceTypeFileValidatorOptions> {
  private readonly strategies: Map<ResourceType, IFileValidationStrategy>;

  /**
   * Set by isValid() when the file content does not match its declared media
   * MIME type, so buildErrorMessage() can report the right reason. Safe
   * because a validator instance is created per upload request.
   */
  private contentTypeMismatch = false;

  constructor(validationOptions: ResourceTypeFileValidatorOptions) {
    super(validationOptions);
    this.strategies = this.buildStrategyRegistry();
  }

  /**
   * Build the strategy registry mapping ResourceType to validation strategy
   */
  private buildStrategyRegistry(): Map<ResourceType, IFileValidationStrategy> {
    return new Map<ResourceType, IFileValidationStrategy>([
      [
        ResourceType.MESSAGE_ATTACHMENT,
        new MessageAttachmentValidationStrategy(),
      ],
      [ResourceType.USER_AVATAR, new UserAvatarValidationStrategy()],
      [ResourceType.USER_BANNER, new UserAvatarValidationStrategy()],
      [ResourceType.COMMUNITY_AVATAR, new CommunityBannerValidationStrategy()],
      [ResourceType.COMMUNITY_BANNER, new CommunityBannerValidationStrategy()],
      [ResourceType.CUSTOM_EMOJI, new CustomEmojiValidationStrategy()],
      [ResourceType.SOUNDBOARD_SOUND, new SoundboardSoundValidationStrategy()],
    ]);
  }

  async isValid(file?: Express.Multer.File): Promise<boolean> {
    // Reset per validation so a reused instance (e.g. a construct-once pipe)
    // never reports a stale mismatch message for a different failure.
    this.contentTypeMismatch = false;

    if (!file) {
      return false;
    }

    const strategy = this.strategies.get(this.validationOptions.resourceType);

    if (!strategy) {
      return false;
    }

    // Check MIME type
    const allowedMimeTypes = strategy.getAllowedMimeTypes();
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return false;
    }

    // For image, video and audio MIME claims, verify the content's magic
    // bytes match the declared format (blocks e.g. renamed executables
    // claiming image/png or video/x-msvideo). Documents and archives pass
    // through unchanged.
    if (/^(image|video|audio)\//.test(file.mimetype)) {
      const header = await readFileHeader(file);
      if (!matchesDeclaredMediaType(header, file.mimetype)) {
        this.contentTypeMismatch = true;
        return false;
      }
    }

    // Check file size
    const maxSize = strategy.getMaxFileSize(file.mimetype);
    if (file.size > maxSize) {
      return false;
    }

    // Check additional validation if defined
    if (strategy.validateAdditional) {
      return strategy.validateAdditional(file);
    }

    return true;
  }

  buildErrorMessage(file: Express.Multer.File): string {
    const strategy = this.strategies.get(this.validationOptions.resourceType);

    if (!strategy) {
      return `Invalid resource type: ${this.validationOptions.resourceType}`;
    }

    const allowedMimeTypes = strategy.getAllowedMimeTypes();
    const maxSize = strategy.getMaxFileSize(file.mimetype);

    if (!allowedMimeTypes.includes(file.mimetype)) {
      return `Invalid file type. ${strategy.getValidationDescription()}`;
    }

    if (this.contentTypeMismatch) {
      return `File content does not match the declared type "${file.mimetype}". The file may be corrupted or mislabeled.`;
    }

    if (file.size > maxSize) {
      const maxSizeMB = (maxSize / 1024 / 1024).toFixed(2);
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      return `File too large (${fileSizeMB}MB). Maximum allowed size is ${maxSizeMB}MB for ${this.validationOptions.resourceType}`;
    }

    return `File validation failed. ${strategy.getValidationDescription()}`;
  }
}
