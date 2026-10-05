import { describe, it, expect } from 'vitest';
import {
  ADMIN_ERROR_COPY,
  COMMUNITY_ERROR_COPY,
  getPageErrorInfo,
  getPageErrorKind,
} from '../../utils/pageError';

describe('getPageErrorKind', () => {
  it('maps 401/403 to forbidden, 404 to not-found, anything else to server', () => {
    expect(getPageErrorKind({ statusCode: 403 })).toBe('forbidden');
    expect(getPageErrorKind({ statusCode: 401 })).toBe('forbidden');
    expect(getPageErrorKind({ statusCode: 404 })).toBe('not-found');
    expect(getPageErrorKind({ statusCode: 500 })).toBe('server');
    expect(getPageErrorKind(new Error('network'))).toBe('server');
    expect(getPageErrorKind(undefined)).toBe('server');
  });
});

describe('getPageErrorInfo', () => {
  it('picks the copy for the kind and only offers retry for server faults', () => {
    expect(getPageErrorInfo({ statusCode: 403 }, COMMUNITY_ERROR_COPY)).toMatchObject({
      kind: 'forbidden',
      title: "You don't have access to this community",
      retryable: false,
    });
    expect(getPageErrorInfo({ statusCode: 404 }, COMMUNITY_ERROR_COPY)).toMatchObject({
      kind: 'not-found',
      retryable: false,
    });
    expect(getPageErrorInfo({ statusCode: 500 }, COMMUNITY_ERROR_COPY)).toMatchObject({
      kind: 'server',
      title: "Couldn't load this community",
      retryable: true,
    });
  });

  it('says admin 403 is a permission matter, not a fault', () => {
    expect(getPageErrorInfo({ statusCode: 403 }, ADMIN_ERROR_COPY).title).toBe(
      "You don't have access to the admin dashboard",
    );
  });
});
