/**
 * useVoicePresenceSounds Hook
 *
 * Plays sounds when other users join/leave the voice channel the local user
 * is currently connected to. Ignores events about the local user (their own
 * connection sounds are handled in voiceActions.ts).
 */

import { ServerEvents } from '@kraken/shared';
import { useServerEvent } from '../socket-hub/useServerEvent';
import { useVoice } from '../contexts/VoiceContext';
import { useCurrentUser } from './useCurrentUser';
import { playSound, Sounds } from './useSound';

export function useVoicePresenceSounds() {
  const voiceState = useVoice();
  const { user } = useCurrentUser();

  // Channel voice — other user joined
  useServerEvent(ServerEvents.VOICE_CHANNEL_USER_JOINED, (data: { channelId: string; user: { id: string } }) => {
    if (!voiceState.isConnected) return;
    if (data.channelId !== voiceState.currentChannelId) return;
    if (data.user.id === user?.id) return;
    playSound(Sounds.voiceUserJoined);
  });

  // Channel voice — other user left
  useServerEvent(ServerEvents.VOICE_CHANNEL_USER_LEFT, (data: { channelId: string; userId: string }) => {
    if (!voiceState.isConnected) return;
    if (data.channelId !== voiceState.currentChannelId) return;
    if (data.userId === user?.id) return;
    playSound(Sounds.voiceUserLeft);
  });

  // DM voice — other user joined
  useServerEvent(ServerEvents.DM_VOICE_USER_JOINED, (data: { dmGroupId: string; user: { id: string } }) => {
    if (!voiceState.isConnected) return;
    if (data.dmGroupId !== voiceState.currentDmGroupId) return;
    if (data.user.id === user?.id) return;
    playSound(Sounds.voiceUserJoined);
  });

  // DM voice — other user left
  useServerEvent(ServerEvents.DM_VOICE_USER_LEFT, (data: { dmGroupId: string; userId: string }) => {
    if (!voiceState.isConnected) return;
    if (data.dmGroupId !== voiceState.currentDmGroupId) return;
    if (data.userId === user?.id) return;
    playSound(Sounds.voiceUserLeft);
  });
}
