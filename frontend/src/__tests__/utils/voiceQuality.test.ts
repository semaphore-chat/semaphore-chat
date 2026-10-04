import { describe, it, expect } from 'vitest';
import { getMicPublishDefaults, isMicQuality } from '../../utils/voiceQuality';

describe('getMicPublishDefaults', () => {
  it('high', () => {
    expect(getMicPublishDefaults('high')).toEqual({ audioPreset: { maxBitrate: 96000 }, dtx: true, red: true });
  });
  it('standard', () => {
    expect(getMicPublishDefaults('standard')).toEqual({ audioPreset: { maxBitrate: 48000 }, dtx: true, red: true });
  });
  it('music disables dtx', () => {
    expect(getMicPublishDefaults('music')).toEqual({ audioPreset: { maxBitrate: 128000 }, dtx: false, red: true });
  });
  it('falls back to high for unknown values', () => {
    const high = getMicPublishDefaults('high');
    expect(getMicPublishDefaults(undefined)).toEqual(high);
    expect(getMicPublishDefaults('bogus')).toEqual(high);
  });
});

describe('isMicQuality', () => {
  it('accepts known qualities only', () => {
    expect(isMicQuality('standard')).toBe(true);
    expect(isMicQuality('high')).toBe(true);
    expect(isMicQuality('music')).toBe(true);
    expect(isMicQuality('bogus')).toBe(false);
    expect(isMicQuality(undefined)).toBe(false);
    expect(isMicQuality(96000)).toBe(false);
  });
});
