import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { UnauthorizedException } from '@nestjs/common';

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
  });

  describe('handleRequest', () => {
    it('should return the user when authentication succeeds', () => {
      const user = { id: 'user-1', username: 'test' };

      const result = guard.handleRequest(null, user);

      expect(result).toBe(user);
    });

    it('should return null when no user is found (no token)', () => {
      const result = guard.handleRequest(null, false);

      expect(result).toBeNull();
    });

    it('should return null when authentication errors (invalid token)', () => {
      const err = new UnauthorizedException('Invalid token');

      const result = guard.handleRequest(err, false);

      expect(result).toBeNull();
    });

    it('should return null when user is undefined', () => {
      const result = guard.handleRequest(null, undefined);

      expect(result).toBeNull();
    });

    it('should return null when user is null', () => {
      const result = guard.handleRequest(null, null);

      expect(result).toBeNull();
    });

    it('should rethrow non-authentication errors', () => {
      const err = new Error('Database connection failed');

      expect(() => guard.handleRequest(err, false)).toThrow(
        'Database connection failed',
      );
    });

    it('should rethrow TypeError from strategy', () => {
      const err = new TypeError('Cannot read properties of undefined');

      expect(() => guard.handleRequest(err, false)).toThrow(TypeError);
    });
  });
});
