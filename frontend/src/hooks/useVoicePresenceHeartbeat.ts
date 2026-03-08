import { useEffect, useRef } from 'react';
import { VoiceSessionType } from '../contexts/VoiceContext';
import { voicePresenceControllerRefreshPresence } from '../api-client/sdk.gen';
import { dmVoicePresenceControllerRefreshDmPresence } from '../api-client/sdk.gen';
import { logger } from '../utils/logger';

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

interface VoicePresenceHeartbeatParams {
  channelId: string | null;
  dmGroupId: string | null;
  contextType: VoiceSessionType | null;
}

/**
 * Sends periodic presence heartbeats to keep the Redis TTL alive
 * while the user is connected to a voice channel or DM call.
 *
 * Uses a Web Worker timer to avoid background-tab throttling (browsers
 * throttle setInterval to ~1/min in background tabs, but the Redis TTL
 * is 90s). Falls back to setInterval if Worker creation fails.
 */
export function useVoicePresenceHeartbeat({
  channelId,
  dmGroupId,
  contextType,
}: VoicePresenceHeartbeatParams) {
  const workerRef = useRef<Worker | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isChannel = contextType === VoiceSessionType.Channel && channelId;
    const isDm = contextType === VoiceSessionType.Dm && dmGroupId;

    if (!isChannel && !isDm) {
      return;
    }

    const sendHeartbeat = async () => {
      try {
        if (isChannel) {
          await voicePresenceControllerRefreshPresence({
            path: { channelId },
          });
        } else if (isDm) {
          await dmVoicePresenceControllerRefreshDmPresence({
            path: { dmGroupId },
          });
        }
      } catch (err) {
        logger.warn('[VoicePresenceHeartbeat] Failed to refresh presence:', err);
      }
    };

    // Send immediately on mount
    sendHeartbeat();

    // Try using a Web Worker timer to avoid background-tab throttling
    const fallbackToInterval = () => {
      if (!intervalRef.current) {
        intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
      }
    };

    try {
      const worker = new Worker(
        new URL('../workers/background-timer.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e) => {
        if (e.data.type === 'tick' && e.data.name === 'heartbeat') {
          sendHeartbeat();
        }
      };
      worker.onerror = () => {
        // Worker script failed to load — tear down and fall back to setInterval
        worker.terminate();
        workerRef.current = null;
        fallbackToInterval();
      };
      worker.postMessage({ type: 'start', name: 'heartbeat', interval: HEARTBEAT_INTERVAL_MS });
      workerRef.current = worker;
    } catch {
      // Synchronous Worker creation failed — fall back to setInterval
      fallbackToInterval();
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'stop', name: 'heartbeat' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [channelId, dmGroupId, contextType]);
}
