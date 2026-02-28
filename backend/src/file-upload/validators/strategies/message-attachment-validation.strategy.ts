import { IFileValidationStrategy } from './file-validation-strategy.interface';

/**
 * Validation strategy for message attachments
 * Supports images, videos, documents, and audio with generous limits
 */
export class MessageAttachmentValidationStrategy implements IFileValidationStrategy {
  private readonly MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
  private readonly MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB
  private readonly MAX_DOCUMENT_SIZE = 100 * 1024 * 1024; // 100MB
  private readonly MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB

  private readonly allowedMimeTypes = [
    // Images
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // Videos
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime', // .mov
    'video/x-msvideo', // .avi
    // Documents
    'application/pdf',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint', // .ppt
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'text/plain',
    'text/csv',
    // Archives
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.rar', // Official RAR MIME type (IANA registered)
    'application/x-rar-compressed', // Deprecated but still common
    'application/x-rar', // Alternative RAR type
    'application/rar', // Some systems use this
    'application/x-7z-compressed',
    'application/x-compressed',
    'application/gzip',
    'application/x-gzip',
    'application/x-tar',
    'application/x-bzip',
    'application/x-bzip2',
    'application/octet-stream', // Generic binary - often used for zip/rar/archive files
    // Audio
    'audio/mpeg', // .mp3
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
  ];

  getAllowedMimeTypes(): string[] {
    return this.allowedMimeTypes;
  }

  getMaxFileSize(mimeType: string): number {
    // Validate size based on mimetype
    if (mimeType.startsWith('video/')) {
      return this.MAX_VIDEO_SIZE;
    }
    if (mimeType.startsWith('image/')) {
      return this.MAX_IMAGE_SIZE;
    }
    if (mimeType.startsWith('audio/')) {
      return this.MAX_AUDIO_SIZE;
    }
    // Documents (application/* and text/*)
    return this.MAX_DOCUMENT_SIZE;
  }

  getValidationDescription(): string {
    return 'Images (25MB), Videos (500MB), Documents/Archives (100MB), Audio (50MB)';
  }
}
