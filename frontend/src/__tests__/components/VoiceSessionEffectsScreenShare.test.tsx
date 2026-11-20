/**
 * The screen share's session effects run with the call (VoiceSessionEffects),
 * not with the classic voice bar (design F6, R9): a share's audio-failed
 * notice and own-share reveal work on any screen.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => ({ state: { isConnected: true, room: null }, actions: {} }),
}));
vi.mock('../../hooks/useLocalMediaState', () => ({
  useLocalMediaState: () => ({ isMicrophoneEnabled: true, isCameraEnabled: false, isScreenShareEnabled: false }),
}));
vi.mock('../../hooks/useVoicePublishPermissions', () => ({
  useVoicePublishPermissions: () => ({ canSpeak: true, canVideo: true, canShare: true }),
}));
vi.mock('../../hooks/usePushToTalk', () => ({ usePushToTalk: vi.fn() }));
vi.mock('../../hooks/useBackgroundVoiceKeepAlive', () => ({ useBackgroundVoiceKeepAlive: vi.fn() }));
vi.mock('../../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));
vi.mock('../../hooks/useVoiceMediaSession', () => ({ useVoiceMediaSession: vi.fn() }));
vi.mock('../../hooks/useVoicePresenceHeartbeat', () => ({ useVoicePresenceHeartbeat: vi.fn() }));
vi.mock('../../hooks/useDeafenEffect', () => ({ useDeafenEffect: vi.fn() }));
vi.mock('../../hooks/useServerMuteEffect', () => ({ useServerMuteEffect: vi.fn() }));
vi.mock('../../hooks/useRemoteVolumeEffect', () => ({ useRemoteVolumeEffect: vi.fn() }));
vi.mock('../../hooks/useScreenShareSession', () => ({ useScreenShareSession: vi.fn() }));

import VoiceSessionEffects from '../../components/Voice/VoiceSessionEffects';
import { useScreenShareSession } from '../../hooks/useScreenShareSession';

describe('VoiceSessionEffects and screen share', () => {
  it('runs the screen-share session effects during an active call, with no voice bar mounted', () => {
    render(<VoiceSessionEffects active />);
    expect(useScreenShareSession).toHaveBeenCalled();
  });

  it('does not run them before the call is active', () => {
    vi.mocked(useScreenShareSession).mockClear();
    render(<VoiceSessionEffects active={false} />);
    expect(useScreenShareSession).not.toHaveBeenCalled();
  });
});
