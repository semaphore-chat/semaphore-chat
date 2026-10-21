import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { DMVoiceControls } from '../../components/DirectMessage/DMVoiceControls';
import { VoiceSessionType } from '../../contexts/VoiceContext';

const voice = vi.hoisted(() => ({
  state: {
    isConnected: false,
    contextType: null as string | null,
    currentDmGroupId: null as string | null,
  },
  actions: {
    joinDmVoice: vi.fn(),
    leaveVoiceChannel: vi.fn(),
    toggleVideo: vi.fn(),
    revealVideoTiles: vi.fn(),
  },
}));

vi.mock('../../hooks/useVoiceConnection', () => ({
  useVoiceConnection: () => voice,
}));

function resetVoice() {
  voice.state.isConnected = false;
  voice.state.contextType = null;
  voice.state.currentDmGroupId = null;
  voice.actions.joinDmVoice.mockReset().mockResolvedValue(undefined);
  voice.actions.leaveVoiceChannel.mockReset().mockResolvedValue(undefined);
  voice.actions.toggleVideo.mockReset().mockResolvedValue(undefined);
  voice.actions.revealVideoTiles.mockReset();
}

const phoneButton = () => screen.getByTestId('PhoneIcon').closest('button') as HTMLButtonElement;
const videoButton = () => screen.getByTestId('VideocamIcon').closest('button') as HTMLButtonElement;

describe('DMVoiceControls', () => {
  beforeEach(resetVoice);

  it('disables both call buttons until the conversation name is known', () => {
    renderWithProviders(<DMVoiceControls dmGroupId="dm-1" />);

    expect(phoneButton()).toBeDisabled();
    expect(videoButton()).toBeDisabled();
  });

  it('starts a voice call for the DM group', async () => {
    const { user } = renderWithProviders(<DMVoiceControls dmGroupId="dm-1" dmGroupName="Alice" />);

    await user.click(phoneButton());

    expect(voice.actions.joinDmVoice).toHaveBeenCalledWith('dm-1', 'Alice');
    expect(voice.actions.toggleVideo).not.toHaveBeenCalled();
  });

  it('starts a video call by joining audio, enabling video and revealing the tiles', async () => {
    const { user } = renderWithProviders(<DMVoiceControls dmGroupId="dm-1" dmGroupName="Alice" />);

    await user.click(videoButton());

    expect(voice.actions.joinDmVoice).toHaveBeenCalledWith('dm-1', 'Alice');
    expect(voice.actions.toggleVideo).toHaveBeenCalledTimes(1);
    expect(voice.actions.revealVideoTiles).toHaveBeenCalledTimes(1);
    // Video must only be enabled after the join resolves.
    expect(voice.actions.joinDmVoice.mock.invocationCallOrder[0]).toBeLessThan(
      voice.actions.toggleVideo.mock.invocationCallOrder[0],
    );
  });

  it('shows a spinner and ignores further clicks while the join is pending', async () => {
    let resolveJoin: () => void = () => {};
    voice.actions.joinDmVoice.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveJoin = resolve;
      }),
    );

    const { user } = renderWithProviders(<DMVoiceControls dmGroupId="dm-1" dmGroupName="Alice" />);
    const phone = phoneButton();

    await user.click(phone);

    // Both buttons show their own spinner and are disabled while joining.
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(phone).toBeDisabled();
    fireEvent.click(phone);
    expect(voice.actions.joinDmVoice).toHaveBeenCalledTimes(1);

    resolveJoin();
    await waitFor(() => expect(screen.queryAllByRole('progressbar')).toHaveLength(0));
    expect(phoneButton()).toBeEnabled();
  });

  it('recovers when the join fails', async () => {
    voice.actions.joinDmVoice.mockRejectedValue(new Error('LiveKit unreachable'));

    const { user } = renderWithProviders(<DMVoiceControls dmGroupId="dm-1" dmGroupName="Alice" />);

    await user.click(phoneButton());

    await waitFor(() => expect(phoneButton()).toBeEnabled());
    expect(voice.actions.joinDmVoice).toHaveBeenCalledTimes(1);
  });

  it('shows the in-call chip instead of call buttons while connected to this DM', () => {
    voice.state.isConnected = true;
    voice.state.contextType = VoiceSessionType.Dm;
    voice.state.currentDmGroupId = 'dm-1';

    renderWithProviders(<DMVoiceControls dmGroupId="dm-1" dmGroupName="Alice" />);

    expect(screen.getByText('In Call')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disables starting a call while connected to a different DM', () => {
    voice.state.isConnected = true;
    voice.state.contextType = VoiceSessionType.Dm;
    voice.state.currentDmGroupId = 'dm-2';

    renderWithProviders(<DMVoiceControls dmGroupId="dm-1" dmGroupName="Alice" />);

    expect(phoneButton()).toBeDisabled();
    expect(videoButton()).toBeDisabled();
    expect(voice.actions.joinDmVoice).not.toHaveBeenCalled();
  });

  it('disables the call buttons while connected to a channel call', () => {
    voice.state.isConnected = true;
    voice.state.contextType = VoiceSessionType.Channel;
    voice.state.currentDmGroupId = null;

    renderWithProviders(<DMVoiceControls dmGroupId="dm-1" dmGroupName="Alice" />);

    expect(phoneButton()).toBeDisabled();
    expect(videoButton()).toBeDisabled();
  });
});
