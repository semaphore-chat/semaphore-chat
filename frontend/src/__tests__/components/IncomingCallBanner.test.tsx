import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { IncomingCallBanner } from '../../components/DirectMessage/IncomingCallBanner';

const call = vi.hoisted(() => ({
  incoming: null as null | {
    dmGroupId: string;
    dmGroupName: string;
    callerName: string;
    callerAvatar: string | null;
    startedAt: number;
  },
  dismissCall: vi.fn(),
}));

vi.mock('../../contexts/IncomingCallContext', () => ({
  useIncomingCall: () => ({ incomingCall: call.incoming, dismissCall: call.dismissCall }),
}));

const voice = vi.hoisted(() => ({
  actions: { joinDmVoice: vi.fn() },
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: {}, actions: voice.actions }),
}));

const sounds = vi.hoisted(() => ({ playSound: vi.fn() }));
vi.mock('../../hooks/useSound', () => ({
  playSound: sounds.playSound,
  stopSound: vi.fn(),
  Sounds: { callEnded: 'callEnded', incomingCall: 'incomingCall' },
}));

// The banner has no FileCacheProvider here: render the fallback (initials) avatar.
vi.mock('../../components/Common/AuthenticatedImage', () => ({
  AuthenticatedImage: ({ fallback }: { fallback?: React.ReactNode }) => <>{fallback}</>,
}));

const incomingCall = {
  dmGroupId: 'dm-1',
  dmGroupName: 'Weekend Plans',
  callerName: 'Priya Diallo',
  callerAvatar: null as string | null,
  startedAt: Date.now(),
};

describe('IncomingCallBanner', () => {
  beforeEach(() => {
    call.incoming = { ...incomingCall };
    call.dismissCall.mockReset();
    voice.actions.joinDmVoice.mockReset().mockResolvedValue(undefined);
    sounds.playSound.mockReset();
  });

  it('renders nothing when no call is ringing', () => {
    call.incoming = null;

    renderWithProviders(<IncomingCallBanner />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the caller name and the fallback initial while ringing', () => {
    renderWithProviders(<IncomingCallBanner />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Priya Diallo')).toBeInTheDocument();
    expect(screen.getByText('Incoming voice call')).toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('accepts the call, joining the DM voice group and dismissing the banner', async () => {
    const { user } = renderWithProviders(<IncomingCallBanner />);

    await user.click(screen.getByTestId('PhoneIcon').closest('button') as HTMLElement);

    expect(voice.actions.joinDmVoice).toHaveBeenCalledWith('dm-1', 'Weekend Plans');
    await waitFor(() => expect(call.dismissCall).toHaveBeenCalledTimes(1));
  });

  it('keeps ringing when accepting the call fails', async () => {
    voice.actions.joinDmVoice.mockRejectedValue(new Error('LiveKit unreachable'));

    const { user } = renderWithProviders(<IncomingCallBanner />);

    await user.click(screen.getByTestId('PhoneIcon').closest('button') as HTMLElement);

    await waitFor(() => expect(voice.actions.joinDmVoice).toHaveBeenCalled());
    expect(call.dismissCall).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('declines the call, playing the end sound and dismissing it', async () => {
    const { user } = renderWithProviders(<IncomingCallBanner />);

    await user.click(screen.getByTestId('CallEndIcon').closest('button') as HTMLElement);

    expect(sounds.playSound).toHaveBeenCalledWith('callEnded');
    expect(call.dismissCall).toHaveBeenCalledTimes(1);
    expect(voice.actions.joinDmVoice).not.toHaveBeenCalled();
  });
});
