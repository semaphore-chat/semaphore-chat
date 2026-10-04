import { describe, it, expect, beforeEach } from 'vitest';
import {
  setScreenShareConfig,
  getScreenShareSettings,
  getScreenSourceId,
  clearScreenShareConfig,
  DEFAULT_SCREEN_SHARE_SETTINGS,
} from '../../utils/screenShareState';

describe('screenShareState', () => {
  beforeEach(() => {
    clearScreenShareConfig();
  });

  describe('set / get round-trip', () => {
    it('stores and retrieves screen source ID', () => {
      setScreenShareConfig('source-123', DEFAULT_SCREEN_SHARE_SETTINGS);
      expect(getScreenSourceId()).toBe('source-123');
    });

    it('stores and retrieves screen share settings', () => {
      const settings = { resolution: '720p', fps: 60, enableAudio: false };
      setScreenShareConfig('src-1', settings);

      const result = getScreenShareSettings();
      expect(result).toEqual(settings);
    });
  });

  describe('clearScreenShareConfig', () => {
    it('clears both source ID and settings', () => {
      setScreenShareConfig('src-1', DEFAULT_SCREEN_SHARE_SETTINGS);
      clearScreenShareConfig();

      expect(getScreenSourceId()).toBeUndefined();
      expect(getScreenShareSettings()).toBeUndefined();
    });
  });

  describe('default values', () => {
    it('returns undefined for source ID when not set', () => {
      expect(getScreenSourceId()).toBeUndefined();
    });

    it('returns undefined for settings when not set', () => {
      expect(getScreenShareSettings()).toBeUndefined();
    });
  });

  describe('DEFAULT_SCREEN_SHARE_SETTINGS', () => {
    it('has expected default values', () => {
      expect(DEFAULT_SCREEN_SHARE_SETTINGS).toEqual({
        resolution: '1080p',
        fps: 60,
        enableAudio: true,
      });
    });
  });

  describe('overwriting', () => {
    it('overwrites previous config with new values', () => {
      setScreenShareConfig('src-1', { resolution: '720p', fps: 30, enableAudio: true });
      setScreenShareConfig('src-2', { resolution: '4k', fps: 60, enableAudio: false });

      expect(getScreenSourceId()).toBe('src-2');
      expect(getScreenShareSettings()!.resolution).toBe('4k');
    });
  });
});
