import { useState, useEffect, useRef, useCallback } from "react";
import { useRoom } from "./useRoom";
import { Participant, Track } from "livekit-client";
import { getCachedItem } from "../utils/storage";

const VOICE_SETTINGS_KEY = 'kraken_voice_settings';
const HOLD_OPEN_MS = 300;
const MIN_CLOSE_MS = 100;
const HYSTERESIS_OFFSET = 5;
const SETTINGS_READ_INTERVAL = 60; // Re-read localStorage every ~60 frames (~1s at 60fps)

interface VoiceSettingsCache {
  inputMode?: string;
  voiceActivityThreshold?: number;
}

interface ParsedSettings {
  threshold: number;
  isVoiceActivity: boolean;
}

/**
 * Hook to detect speaking state for all participants in a LiveKit room,
 * and gate local audio transmission in Voice Activity mode.
 *
 * For the local participant, uses a single AnalyserNode + requestAnimationFrame
 * loop to both update the speaking indicator AND control `mediaStreamTrack.enabled`
 * (sending silence frames when below threshold). The gate and indicator share
 * identical timing so they stay perfectly in sync.
 *
 * For remote participants, uses LiveKit's built-in `isSpeaking` detection.
 *
 * Gate behaviour (Voice Activity mode only):
 * - **Hold-open**: 300ms delay before closing after speech stops
 * - **Hysteresis**: close threshold is 5 points below open threshold
 * - **Min close time**: 100ms minimum before re-opening
 * - **Cleanup**: re-enables `mediaStreamTrack.enabled` only if gate disabled it
 *
 * @example
 * const { speakingMap, isSpeaking } = useSpeakingDetection();
 * const userIsSpeaking = isSpeaking(userId);
 */
export const useSpeakingDetection = () => {
  const { room } = useRoom();
  const [speakingMap, setSpeakingMap] = useState<Map<string, boolean>>(new Map());

  // Custom audio analysis refs for local participant
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const localAnalysisActiveRef = useRef(false);
  const localTrackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisTrackRef = useRef<MediaStreamTrack | null>(null);
  const analysisTrackIsCloneRef = useRef(false);

  // Gate state refs (used for both indicator and audio gating)
  const gateOpenRef = useRef(true);
  const gateDisabledTrackRef = useRef(false); // true only when OUR gate set track.enabled = false
  const lastAboveThresholdRef = useRef(0);
  const lastGateCloseRef = useRef(0);

  // Cached settings — re-read from localStorage periodically, not every frame
  const cachedSettingsRef = useRef<ParsedSettings>({ threshold: 25, isVoiceActivity: true });
  const frameCountRef = useRef(0);

  const readSettings = useCallback((): ParsedSettings => {
    const settings = getCachedItem<VoiceSettingsCache>(VOICE_SETTINGS_KEY);
    return {
      threshold: settings?.voiceActivityThreshold ?? 25,
      isVoiceActivity: (settings?.inputMode ?? 'voice_activity') === 'voice_activity',
    };
  }, []);

  useEffect(() => {
    if (!room) {
      setSpeakingMap(new Map());
      return;
    }

    // ---------------------------------------------------------------
    // Remote participants: use LiveKit's built-in isSpeaking
    // ---------------------------------------------------------------
    const handlers = new Map<string, (speaking: boolean) => void>();

    const attachRemoteHandler = (participant: Participant) => {
      const handleSpeakingChange = (speaking: boolean) => {
        setSpeakingMap((prev) => {
          const newMap = new Map(prev);
          newMap.set(participant.identity, speaking);
          return newMap;
        });
      };

      handlers.set(participant.identity, handleSpeakingChange);
      participant.on("isSpeakingChanged", handleSpeakingChange);

      setSpeakingMap((prev) => {
        const newMap = new Map(prev);
        newMap.set(participant.identity, participant.isSpeaking);
        return newMap;
      });
    };

    // Attach to existing remote participants
    room.remoteParticipants.forEach((participant) => {
      attachRemoteHandler(participant);
    });

    const handleParticipantConnected = (participant: Participant) => {
      attachRemoteHandler(participant);
    };

    const handleParticipantDisconnected = (participant: Participant) => {
      const handler = handlers.get(participant.identity);
      if (handler) {
        participant.off("isSpeakingChanged", handler);
        handlers.delete(participant.identity);
      }
      setSpeakingMap((prev) => {
        const newMap = new Map(prev);
        newMap.delete(participant.identity);
        return newMap;
      });
    };

    room.on("participantConnected", handleParticipantConnected);
    room.on("participantDisconnected", handleParticipantDisconnected);

    // ---------------------------------------------------------------
    // Local participant: unified audio analysis + gating
    // ---------------------------------------------------------------
    const local = room.localParticipant;

    const startLocalAnalysis = () => {
      // Find the local microphone track's MediaStream
      const micPub = local.getTrackPublication(Track.Source.Microphone);
      const mediaStreamTrack = micPub?.track?.mediaStreamTrack;
      if (!mediaStreamTrack) return;

      // Build an AnalyserNode from the mic track
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;

        // Clone the track for analysis so its `enabled` state is independent.
        // The analyser always reads real audio from the clone, while the gate
        // toggles `enabled` only on the original (published) track.
        let analysisTrack: MediaStreamTrack;
        try {
          analysisTrack = mediaStreamTrack.clone();
          analysisTrackIsCloneRef.current = true;
        } catch {
          // Fallback: use the original (pre-fix behavior)
          analysisTrack = mediaStreamTrack;
          analysisTrackIsCloneRef.current = false;
        }
        analysisTrackRef.current = analysisTrack;

        const stream = new MediaStream([analysisTrack]);
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        localAnalysisActiveRef.current = true;

        // Initialize gate state
        gateOpenRef.current = true;
        gateDisabledTrackRef.current = false;
        lastAboveThresholdRef.current = Date.now();
        lastGateCloseRef.current = 0;

        // Read settings immediately on start
        cachedSettingsRef.current = readSettings();
        frameCountRef.current = 0;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!localAnalysisActiveRef.current || !analyserRef.current) return;

          // Periodically re-read settings from localStorage (not every frame)
          frameCountRef.current++;
          if (frameCountRef.current >= SETTINGS_READ_INTERVAL) {
            frameCountRef.current = 0;
            cachedSettingsRef.current = readSettings();
          }

          analyser.getByteFrequencyData(dataArray);

          // Compute RMS-like level (0-100)
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          const level = (average / 255) * 100;

          const { threshold, isVoiceActivity } = cachedSettingsRef.current;
          const now = Date.now();

          if (isVoiceActivity) {
            // ---------- Gated mode: drive both indicator and track.enabled ----------
            if (gateOpenRef.current) {
              // Gate is open — check if we should close
              const closeThreshold = Math.max(0, threshold - HYSTERESIS_OFFSET);
              if (level > closeThreshold) {
                lastAboveThresholdRef.current = now;
                // Keep speaking indicator on while gate is open and transmitting
                setSpeakingMap((prev) => {
                  if (prev.get(local.identity) === true) return prev;
                  const newMap = new Map(prev);
                  newMap.set(local.identity, true);
                  return newMap;
                });
              } else {
                const elapsed = now - lastAboveThresholdRef.current;
                if (elapsed >= HOLD_OPEN_MS) {
                  gateOpenRef.current = false;
                  gateDisabledTrackRef.current = true;
                  lastGateCloseRef.current = now;
                  mediaStreamTrack.enabled = false;
                  setSpeakingMap((prev) => {
                    if (prev.get(local.identity) === false) return prev;
                    const newMap = new Map(prev);
                    newMap.set(local.identity, false);
                    return newMap;
                  });
                }
              }
            } else {
              // Gate is closed — check if we should open
              if (level > threshold) {
                const closedFor = now - lastGateCloseRef.current;
                if (closedFor >= MIN_CLOSE_MS) {
                  gateOpenRef.current = true;
                  gateDisabledTrackRef.current = false;
                  lastAboveThresholdRef.current = now;
                  mediaStreamTrack.enabled = true;
                  setSpeakingMap((prev) => {
                    if (prev.get(local.identity) === true) return prev;
                    const newMap = new Map(prev);
                    newMap.set(local.identity, true);
                    return newMap;
                  });
                }
              }
            }
          } else {
            // ---------- Non-gated mode (PTT): indicator only ----------
            // Only undo gate-caused disables; never touch track.enabled otherwise
            // (PTT/manual mute control it via LiveKit's publish/unpublish)
            if (gateDisabledTrackRef.current) {
              mediaStreamTrack.enabled = true;
              gateDisabledTrackRef.current = false;
              gateOpenRef.current = true;
            }
            const speaking = level > threshold;
            setSpeakingMap((prev) => {
              if (prev.get(local.identity) === speaking) return prev;
              const newMap = new Map(prev);
              newMap.set(local.identity, speaking);
              return newMap;
            });
          }

          animationFrameRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch {
        // Fall back to LiveKit's isSpeaking for local user if Web Audio fails
        const fallback = (speaking: boolean) => {
          setSpeakingMap((prev) => {
            const newMap = new Map(prev);
            newMap.set(local.identity, speaking);
            return newMap;
          });
        };
        handlers.set(local.identity, fallback);
        local.on("isSpeakingChanged", fallback);
      }
    };

    const stopLocalAnalysis = () => {
      localAnalysisActiveRef.current = false;
      if (localTrackTimeoutRef.current) {
        clearTimeout(localTrackTimeoutRef.current);
        localTrackTimeoutRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      if (analysisTrackRef.current && analysisTrackIsCloneRef.current) {
        analysisTrackRef.current.stop();
      }
      analysisTrackRef.current = null;
      analysisTrackIsCloneRef.current = false;

      // Only re-enable track if OUR gate disabled it — don't override
      // explicit user mute/deafen/PTT state
      if (gateDisabledTrackRef.current) {
        const micPub = local.getTrackPublication(Track.Source.Microphone);
        const track = micPub?.track?.mediaStreamTrack;
        if (track) {
          track.enabled = true;
        }
        gateDisabledTrackRef.current = false;
      }
      gateOpenRef.current = true;
    };

    // Start analysis if mic track is already published
    startLocalAnalysis();

    // Re-start if mic track changes (e.g., device switch, mute/unmute)
    const handleLocalTrackPublished = () => {
      stopLocalAnalysis();
      // Small delay to let the track stabilize
      localTrackTimeoutRef.current = setTimeout(() => startLocalAnalysis(), 200);
    };
    const handleLocalTrackUnpublished = () => {
      stopLocalAnalysis();
      setSpeakingMap((prev) => {
        const newMap = new Map(prev);
        newMap.set(local.identity, false);
        return newMap;
      });
    };

    local.on("localTrackPublished", handleLocalTrackPublished);
    local.on("localTrackUnpublished", handleLocalTrackUnpublished);

    const handleActiveDeviceChanged = (kind: MediaDeviceKind) => {
      if (kind === 'audioinput') {
        stopLocalAnalysis();
        localTrackTimeoutRef.current = setTimeout(() => startLocalAnalysis(), 200);
      }
    };
    room.on("activeDeviceChanged", handleActiveDeviceChanged);

    // Cleanup
    return () => {
      // Remote handlers
      handlers.forEach((handler, identity) => {
        const participant =
          identity === room.localParticipant.identity
            ? room.localParticipant
            : room.remoteParticipants.get(identity);
        if (participant) {
          participant.off("isSpeakingChanged", handler);
        }
      });

      room.off("participantConnected", handleParticipantConnected);
      room.off("participantDisconnected", handleParticipantDisconnected);
      room.off("activeDeviceChanged", handleActiveDeviceChanged);

      // Local analysis + gating cleanup
      stopLocalAnalysis();
      local.off("localTrackPublished", handleLocalTrackPublished);
      local.off("localTrackUnpublished", handleLocalTrackUnpublished);
    };
  }, [room, readSettings]);

  /**
   * Check if a specific user (by identity/userId) is currently speaking
   */
  const isSpeaking = (userId: string): boolean => {
    return speakingMap.get(userId) || false;
  };

  return {
    speakingMap,
    isSpeaking,
  };
};
