/**
 * Formats a byte count into a human-readable file size string.
 * e.g. 1024 → "1 KB", 1048576 → "1 MB"
 */
export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

/**
 * Extracts an error message from an API error or standard Error object.
 * Handles RTK Query-style errors with `data.message` and standard Error objects.
 */
export const getErrorMessage = (err: unknown, defaultMessage: string): string => {
  if (err && typeof err === 'object') {
    if ('data' in err && err.data && typeof err.data === 'object' && 'message' in err.data) {
      const message = (err.data as { message: string }).message;
      return typeof message === 'string' ? message : defaultMessage;
    }
    if (err instanceof Error) {
      return err.message || defaultMessage;
    }
    // The generated API client throws the parsed error body itself, e.g. a
    // NestJS `{ statusCode, message, error }`; validation errors carry an array.
    if ('message' in err) {
      const message = (err as { message: unknown }).message;
      if (typeof message === 'string' && message) return message;
      if (Array.isArray(message)) {
        const parts = message.filter((m): m is string => typeof m === 'string' && m.length > 0);
        if (parts.length > 0) return parts.join('. ');
      }
    }
  }
  return defaultMessage;
};

/**
 * Triggers a browser download for a blob URL with the given filename.
 */
export const downloadBlob = (blobUrl: string, filename: string): void => {
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Formats a playback position in seconds as `m:ss` (minutes are not capped
 * or zero-padded), e.g. 0 → "0:00", 65.9 → "1:05", 3600 → "60:00".
 */
export const formatPlaybackTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};
