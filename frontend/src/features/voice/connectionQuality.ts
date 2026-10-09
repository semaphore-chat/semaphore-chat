import { CONNECTION_QUALITY } from './livekitEvents';

export type Quality = (typeof CONNECTION_QUALITY)[keyof typeof CONNECTION_QUALITY];

export interface QualityInfo {
  bars: 0 | 1 | 2 | 3;
  label: string;
  tone: 'positive' | 'warning' | 'negative' | 'unknown';
}

/** Pure: how LiveKit's ConnectionQuality (plus reconnecting) is shown. */
export function describeConnectionQuality(quality: string, reconnecting = false): QualityInfo {
  if (reconnecting) return { bars: 0, label: 'Reconnecting…', tone: 'warning' };
  switch (quality) {
    case CONNECTION_QUALITY.Excellent:
      return { bars: 3, label: 'Excellent', tone: 'positive' };
    case CONNECTION_QUALITY.Good:
      return { bars: 2, label: 'Good', tone: 'positive' };
    case CONNECTION_QUALITY.Poor:
      return { bars: 1, label: 'Poor', tone: 'warning' };
    case CONNECTION_QUALITY.Lost:
      return { bars: 0, label: 'Lost', tone: 'negative' };
    default:
      return { bars: 0, label: 'Measuring…', tone: 'unknown' };
  }
}
