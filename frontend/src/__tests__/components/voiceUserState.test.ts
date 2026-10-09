import { describe, it, expect } from 'vitest';
import { voiceStatusBadges } from '../../components/Voice/components/voiceUserState';

describe('voiceStatusBadges', () => {
  const base = { isMuted: false, isDeafened: false, isServerMuted: false };

  it('nothing unusual → no badges', () => {
    expect(voiceStatusBadges(base)).toEqual([]);
  });

  it('self-muted → one neutral (grey) badge', () => {
    expect(voiceStatusBadges({ ...base, isMuted: true })).toEqual([
      { kind: 'muted', tone: 'neutral', label: 'Muted' },
    ]);
  });

  it('server-muted wins over a self-mute and is danger (red)', () => {
    expect(voiceStatusBadges({ ...base, isMuted: true, isServerMuted: true })).toEqual([
      { kind: 'server-muted', tone: 'danger', label: 'Muted by a moderator' },
    ]);
  });

  it('deafened adds a neutral badge', () => {
    expect(voiceStatusBadges({ ...base, isMuted: true, isDeafened: true }).map((b) => b.kind)).toEqual([
      'muted',
      'deafened',
    ]);
  });
});
