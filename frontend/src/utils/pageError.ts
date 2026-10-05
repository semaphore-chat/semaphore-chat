/**
 * Maps a failed load above the list level (community, profile, admin) to the
 * copy and actions of the shared full-page error state.
 */
import { getHttpStatus } from './httpError';

export type PageErrorKind = 'forbidden' | 'not-found' | 'server';

export interface PageErrorCopy {
  title: string;
  description: string;
}

/** What to say for each failure of one kind of page. */
export interface PageErrorCopySet {
  forbidden: PageErrorCopy;
  notFound: PageErrorCopy;
  server: PageErrorCopy;
}

export interface PageErrorInfo extends PageErrorCopy {
  kind: PageErrorKind;
  /** Retrying can help (a server or network fault, not a 403/404). */
  retryable: boolean;
}

/** 401 and 403 are "you can't see this"; 404 is "it isn't there"; the rest is a fault. */
export function getPageErrorKind(error: unknown): PageErrorKind {
  const status = getHttpStatus(error);
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  return 'server';
}

export function getPageErrorInfo(error: unknown, copy: PageErrorCopySet): PageErrorInfo {
  const kind = getPageErrorKind(error);
  const text = kind === 'forbidden' ? copy.forbidden : kind === 'not-found' ? copy.notFound : copy.server;
  return { kind, ...text, retryable: kind === 'server' };
}

export const COMMUNITY_ERROR_COPY: PageErrorCopySet = {
  forbidden: {
    title: "You don't have access to this community",
    description: "You may have been removed or banned, or the community may be private.",
  },
  notFound: {
    title: 'This community no longer exists',
    description: 'It may have been deleted, or the link is out of date.',
  },
  server: {
    title: "Couldn't load this community",
    description: 'Something went wrong on our side. Check your connection and try again.',
  },
};

export const PROFILE_ERROR_COPY: PageErrorCopySet = {
  forbidden: {
    title: "You can't view this profile",
    description: "You don't have permission to see this user's profile.",
  },
  notFound: {
    title: 'This user does not exist',
    description: 'The account may have been deleted, or the link is out of date.',
  },
  server: {
    title: "Couldn't load this profile",
    description: 'Something went wrong on our side. Check your connection and try again.',
  },
};

export const ADMIN_ERROR_COPY: PageErrorCopySet = {
  forbidden: {
    title: "You don't have access to the admin dashboard",
    description: 'Only instance admins can see this page.',
  },
  notFound: {
    title: "Couldn't find this admin page",
    description: 'It may have moved, or the link is out of date.',
  },
  server: {
    title: "Couldn't load the admin dashboard",
    description: 'Something went wrong on our side. Try again in a moment.',
  },
};
