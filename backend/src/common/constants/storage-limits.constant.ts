/**
 * Storage limits enforced by both `PATCH /instance/settings` and
 * `PATCH /storage/settings`, so the two endpoints can't accept values the
 * other refuses.
 */
export const ONE_GIGABYTE = 1024 * 1024 * 1024;
export const ONE_MEGABYTE = 1024 * 1024;

/** Minimum default storage quota for new users. */
export const MIN_STORAGE_QUOTA_BYTES = ONE_GIGABYTE;

/** Smallest upload a user may be allowed to make. */
export const MIN_FILE_SIZE_BYTES = ONE_MEGABYTE;

/** Largest upload a user may be allowed to make. */
export const MAX_FILE_SIZE_BYTES = ONE_GIGABYTE;
