import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import CompactVoiceTile from '../../components/Voice/CompactVoiceTile';

vi.mock('../../components/Common/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));
vi.mock('../../hooks/useSpeaking', () => ({
  useSpeaking: () => ({ speakingMap: new Map(), isSpeaking: () => false }),
}));

const participant = (metadata?: string) => ({ identity: 'u1', name: 'Ada', metadata }) as never;
const mic = (muted: boolean) => ({ source: 'microphone', isMuted: muted }) as never;

describe('CompactVoiceTile (phone, big calls)', () => {
  it('no badge when the mic is live', () => {
    renderWithProviders(<CompactVoiceTile participant={participant()} audioTrack={mic(false)} />);
    expect(screen.queryByTestId(/voice-badge-/)).not.toBeInTheDocument();
    expect(screen.getByTestId('compact-participant-tile')).toHaveAccessibleName('Ada');
  });

  it('self-muted: a grey badge, not red', () => {
    renderWithProviders(<CompactVoiceTile participant={participant()} />);
    expect(screen.getByTestId('voice-badge-muted')).toBeInTheDocument();
    expect(screen.getByTestId('compact-participant-tile')).toHaveAccessibleName('Ada, muted');
  });

  it('server-muted: the red badge, named for screen readers', () => {
    renderWithProviders(<CompactVoiceTile participant={participant()} isServerMuted />);
    expect(screen.getByTestId('voice-badge-server-muted')).toBeInTheDocument();
    expect(screen.getByTestId('compact-participant-tile')).toHaveAccessibleName('Ada, muted by a moderator');
  });

  it('deafened (which also mutes the mic): the headset badge wins over muted', () => {
    renderWithProviders(<CompactVoiceTile participant={participant(JSON.stringify({ isDeafened: true }))} />);
    expect(screen.getByTestId('voice-badge-deafened')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-badge-muted')).not.toBeInTheDocument();
  });

  it('server-muted wins over deafened', () => {
    renderWithProviders(
      <CompactVoiceTile participant={participant(JSON.stringify({ isDeafened: true }))} isServerMuted />,
    );
    expect(screen.getByTestId('voice-badge-server-muted')).toBeInTheDocument();
  });
});
