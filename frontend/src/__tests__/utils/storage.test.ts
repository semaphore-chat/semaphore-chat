import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCachedItem, setCachedItem, removeCachedItem } from '../../utils/storage';

describe('storage utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('setCachedItem / getCachedItem roundtrip', () => {
    it('stores and retrieves a string value', () => {
      setCachedItem('key1', 'hello');
      expect(getCachedItem<string>('key1')).toBe('hello');
    });

    it('stores and retrieves an object value', () => {
      const obj = { name: 'test', count: 42 };
      setCachedItem('key2', obj);
      expect(getCachedItem<typeof obj>('key2')).toEqual(obj);
    });

    it('stores non-TTL items as plain JSON', () => {
      setCachedItem('key3', 'plain');
      const raw = localStorage.getItem('key3');
      expect(raw).toBe('"plain"');
    });
  });

  describe('TTL behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns the value before TTL expires', () => {
      setCachedItem('ttl-key', 'value', 5000);
      vi.advanceTimersByTime(3000);
      expect(getCachedItem<string>('ttl-key')).toBe('value');
    });

    it('returns null after TTL expires', () => {
      setCachedItem('ttl-key', 'value', 5000);
      vi.advanceTimersByTime(6000);
      expect(getCachedItem<string>('ttl-key')).toBeNull();
    });
  });

  describe('removeCachedItem', () => {
    it('removes the key so getCachedItem returns null', () => {
      setCachedItem('rm-key', 'value');
      removeCachedItem('rm-key');
      expect(getCachedItem<string>('rm-key')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for invalid JSON in localStorage', () => {
      localStorage.setItem('bad-json', '{not valid json!!!');
      expect(getCachedItem('bad-json')).toBeNull();
    });

    it('returns null for missing key', () => {
      expect(getCachedItem('nonexistent')).toBeNull();
    });
  });

  describe('when storage is unavailable (private window, blocked site data)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('getCachedItem returns null when the accessor throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(getCachedItem('anything')).toBeNull();
    });

    it('setCachedItem swallows a throwing (or full) storage', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      expect(() => setCachedItem('k', { a: 1 })).not.toThrow();
      expect(() => setCachedItem('k', { a: 1 }, 1000)).not.toThrow();
    });

    it('removeCachedItem swallows a throwing storage', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      expect(() => removeCachedItem('k')).not.toThrow();
    });
  });
});
