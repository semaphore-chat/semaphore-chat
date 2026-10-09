import { useEffect, useRef, useState } from 'react';
import { VoiceSessionType } from '../contexts/VoiceContext';
import { useVoiceConnection } from './useVoiceConnection';
import { useQuery } from '@tanstack/react-query';
import { userControllerGetProfileOptions, livekitControllerGetConnectionInfoOptions } from '../api-client/@tanstack/react-query.gen';
import { getSavedConnection, clearSavedConnection } from '../features/voice/voiceActions';
import { logger } from '../utils/logger';

/**
 * Hook that attempts to recover voice connection after page refresh.
 *
 * Checks localStorage for saved connection state and attempts to rejoin
 * if the connection was made within the last 5 minutes.
 *
 * Usage: Call this hook at the Layout level after auth is confirmed.
 */
export function useVoiceRecovery() {
  const { state: voiceState, actions } = useVoiceConnection();
  const { data: user, isLoading: userLoading } = useQuery(userControllerGetProfileOptions());
  const { data: connectionInfo, isLoading: connectionLoading } = useQuery(livekitControllerGetConnectionInfoOptions());

  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryAttempted = useRef(false);

  useEffect(() => {
    // Only attempt recovery once per mount
    if (recoveryAttempted.current) return;

    // Wait for user and connection info to be available
    if (userLoading || connectionLoading) return;
    if (!user || !connectionInfo) return;

    // Don't attempt recovery if already connected
    if (voiceState.isConnected || voiceState.isConnecting) return;

    // Check for saved connection
    const savedConnection = getSavedConnection();
    if (!savedConnection) return;

    // Mark as attempted so we don't retry
    recoveryAttempted.current = true;

    // Clear immediately to prevent double-recovery on rapid refresh
    clearSavedConnection();

    const attemptRecovery = async () => {
      logger.info('[VoiceRecovery] Attempting to recover connection:', savedConnection);
      setIsRecovering(true);
      setRecoveryError(null);

      try {
        if (savedConnection.contextType === VoiceSessionType.Channel) {
          // Recover channel voice connection
          if (!savedConnection.channelId || !savedConnection.channelName || !savedConnection.communityId) {
            throw new Error('Invalid saved channel connection data');
          }

          await actions.joinVoiceChannel(
            savedConnection.channelId,
            savedConnection.channelName,
            savedConnection.communityId,
            savedConnection.isPrivate ?? false,
            savedConnection.createdAt ?? new Date().toISOString(),
            // Keep the mic off if it was off (older saved records lack the field)
            { startMuted: savedConnection.micMuted === true },
          );

          logger.info('[VoiceRecovery] ✓ Successfully recovered channel voice connection');
        } else if (savedConnection.contextType === VoiceSessionType.Dm) {
          // Recover DM voice connection
          if (!savedConnection.dmGroupId || !savedConnection.dmGroupName) {
            throw new Error('Invalid saved DM connection data');
          }

          await actions.joinDmVoice(
            savedConnection.dmGroupId,
            savedConnection.dmGroupName
          );

          logger.info('[VoiceRecovery] ✓ Successfully recovered DM voice connection');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to recover voice connection';
        logger.error('[VoiceRecovery] ✗ Failed to recover connection:', message);
        setRecoveryError(message);
      } finally {
        setIsRecovering(false);
      }
    };

    attemptRecovery();
  }, [
    user,
    userLoading,
    connectionInfo,
    connectionLoading,
    voiceState.isConnected,
    voiceState.isConnecting,
    actions,
  ]);

  return {
    isRecovering,
    recoveryError,
  };
}

export default useVoiceRecovery;
