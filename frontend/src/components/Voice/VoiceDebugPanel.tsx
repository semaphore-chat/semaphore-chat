import React, { useEffect, useRef, useState } from 'react';
import { Box, Paper, Typography, Chip, Divider, Button, Stack, Tooltip } from '@mui/material';
import { useTheme, alpha, type Theme } from '@mui/material/styles';
import { ConnectionQuality, Track, RoomEvent } from 'livekit-client';
import type { RemoteParticipant, RemoteTrackPublication } from 'livekit-client';
import { useRoom } from '../../hooks/useRoom';
import { useSpeaking } from '../../hooks/useSpeaking';
import { useTrackSubscriptionActions } from '../../hooks/useTrackSubscription';
import {
  useVoiceEventLog,
  type VoiceEventEntry,
  type VoiceEventSeverity,
} from '../../hooks/useVoiceEventLogDef';
import { useQuery } from '@tanstack/react-query';
import { userControllerGetProfileOptions } from '../../api-client/@tanstack/react-query.gen';
import { VOLUME_STORAGE_PREFIX } from '../../constants/voice';
import {
  parseInboundAudio,
  captureDiagnostics,
  type InboundAudioStats,
} from '../../features/voice/voiceDiagnostics';
import { logger } from '../../utils/logger';

/**
 * Debug panel for diagnosing voice and remote-audio issues.
 *
 * Toggle with Ctrl+Shift+D while in a voice channel.
 *
 * Shows:
 * - Room connection state and counts
 * - Local participant: mic publish state, speaking detection, audio level
 * - **Per-remote-participant audio diagnostics** — the part that helps users
 *   pinpoint asymmetric audio: subscription state, track presence, attached
 *   `<audio>` element count, current volume, and a manual "Force resubscribe"
 *   button as a last-resort recovery action.
 */
export const VoiceDebugPanel: React.FC = () => {
  const theme = useTheme();
  const { room } = useRoom();
  const { speakingMap, isSpeaking } = useSpeaking();
  const trackActions = useTrackSubscriptionActions();
  const log = useVoiceEventLog();
  const { data: currentUser } = useQuery(userControllerGetProfileOptions());
  const [audioLevel, setAudioLevel] = useState(0);

  // Force re-renders on relevant LiveKit events so per-participant chips stay
  // current even when no React state update would otherwise fire.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!room) return;
    const refresh = () => setTick((t) => t + 1);
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ConnectionQualityChanged,
      RoomEvent.TrackSubscriptionStatusChanged,
      RoomEvent.Reconnected,
    ] as const;
    events.forEach((e) => room.on(e, refresh));
    // Also tick at 1Hz so derived fields like volume/attachedElements stay live.
    const interval = setInterval(refresh, 1000);
    return () => {
      events.forEach((e) => room.off(e, refresh));
      clearInterval(interval);
    };
  }, [room]);

  // Per-participant live WebRTC stats (RTT, jitter, packet loss, bitrate,
  // inbound audio level). Polled at 1Hz; bitrate derived from byte deltas.
  const [liveStats, setLiveStats] = useState<Map<string, LiveStatRow>>(new Map());
  const prevSamplesRef = useRef<Map<string, { bytes: number; ts: number }>>(new Map());
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    const poll = async () => {
      const next = new Map<string, LiveStatRow>();
      for (const [, p] of room.remoteParticipants) {
        let micTrack:
          | { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> }
          | undefined;
        for (const [, pub] of p.trackPublications) {
          if (pub.source === Track.Source.Microphone && pub.track) {
            micTrack = pub.track as typeof micTrack;
            break;
          }
        }
        if (!micTrack?.getRTCStatsReport) continue;
        try {
          const report = await micTrack.getRTCStatsReport();
          const parsed = parseInboundAudio(report);
          const prev = prevSamplesRef.current.get(p.identity);
          const now = Date.now();
          let bitrateKbps: number | undefined;
          if (prev && parsed.bytesReceived != null) {
            const dt = (now - prev.ts) / 1000;
            if (dt > 0) bitrateKbps = ((parsed.bytesReceived - prev.bytes) * 8) / 1000 / dt;
          }
          if (parsed.bytesReceived != null) {
            prevSamplesRef.current.set(p.identity, { bytes: parsed.bytesReceived, ts: now });
          }
          next.set(p.identity, { ...parsed, bitrateKbps });
        } catch {
          // ignore transient getStats failures
        }
      }
      if (!cancelled) setLiveStats(next);
    };
    poll();
    const statsInterval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(statsInterval);
    };
  }, [room]);

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const handleExport = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const snapshot = await captureDiagnostics(room, log?.events ?? []);
      const json = JSON.stringify(snapshot, null, 2);
      // Clipboard (best-effort) + file download — same snapshot the window hook returns.
      try {
        await navigator.clipboard?.writeText(json);
      } catch {
        // clipboard may be unavailable (no permission / insecure context)
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voice-diagnostics-${snapshot.capturedAt}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMsg('Copied to clipboard + downloaded');
    } catch (err) {
      logger.error('[VoiceDebugPanel] export failed', err);
      setExportMsg('Export failed — see console');
    } finally {
      setExporting(false);
    }
  };

  const isCurrentUserSpeaking = currentUser ? isSpeaking(currentUser.id) : false;

  // Monitor audio levels from local microphone
  useEffect(() => {
    if (!room) return;

    const localParticipant = room.localParticipant;
    const audioTrack = localParticipant.getTrackPublications().find(
      (pub) => pub.kind === 'audio'
    );

    if (!audioTrack?.track) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const mediaStreamTrack = audioTrack.track.mediaStreamTrack;
    const stream = new MediaStream([mediaStreamTrack]);
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationFrameId: number;

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      const level = Math.min(100, (average / 255) * 100 * 2);
      setAudioLevel(level);

      animationFrameId = requestAnimationFrame(updateLevel);
    };

    updateLevel();

    return () => {
      cancelAnimationFrame(animationFrameId);
      audioContext.close();
    };
  }, [room]);

  if (!room) {
    return (
      <Paper
        sx={{
          position: 'fixed',
          top: 80,
          right: 16,
          p: 2,
          zIndex: 9999,
          minWidth: 320,
          maxHeight: '85vh',
          overflowY: 'auto',
          backgroundColor: alpha(theme.palette.background.paper, 0.95),
          color: theme.palette.text.primary,
        }}
      >
        <Typography variant="h6" gutterBottom>
          🔧 Voice Debug Panel
        </Typography>
        <Divider sx={{ mb: 2, borderColor: 'grey.700' }} />
        <Chip label="NOT CONNECTED TO ROOM" color="error" size="small" />
      </Paper>
    );
  }

  const localParticipant = room.localParticipant;
  const localAudioPub = Array.from(localParticipant.trackPublications.values()).find(
    (pub) => pub.kind === 'audio'
  );

  const remoteParticipants = Array.from(room.remoteParticipants.values());

  return (
    <Paper
      sx={{
        position: 'fixed',
        top: 80,
        right: 16,
        p: 2,
        zIndex: 9999,
        minWidth: 360,
        maxWidth: 480,
        maxHeight: '85vh',
        overflowY: 'auto',
        backgroundColor: alpha(theme.palette.background.paper, 0.95),
        color: theme.palette.text.primary,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6" gutterBottom>
          🔧 Voice Debug Panel
        </Typography>
        <Button
          size="small"
          variant="contained"
          color="primary"
          onClick={handleExport}
          disabled={exporting}
          data-testid="export-diagnostics"
        >
          {exporting ? 'Exporting…' : 'Export'}
        </Button>
      </Box>
      <Typography variant="caption" sx={{ color: 'grey.500', display: 'block', mb: 1 }}>
        Refresh tick: {tick} (auto-updates on events + 1s interval)
        {exportMsg ? ` · ${exportMsg}` : ''}
      </Typography>
      <Divider sx={{ mb: 2, borderColor: 'grey.700' }} />

      {/* ────────────── Room ────────────── */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" sx={{ color: 'grey.400' }}>
          Room
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
          <Chip
            label={`State: ${room.state}`}
            color={room.state === 'connected' ? 'success' : 'warning'}
            size="small"
          />
          <Chip
            label={`Participants: ${room.numParticipants}`}
            color="info"
            size="small"
          />
          <Chip
            label={`Local quality: ${localParticipant.connectionQuality}`}
            color={qualityColor(localParticipant.connectionQuality)}
            size="small"
          />
        </Box>
      </Box>

      {/* ────────────── Local participant ────────────── */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" sx={{ color: 'grey.400' }}>
          Local Mic
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
          {localAudioPub ? (
            <>
              <Chip
                label={localAudioPub.isMuted ? 'MUTED' : 'UNMUTED'}
                color={localAudioPub.isMuted ? 'error' : 'success'}
                size="small"
              />
              <Chip
                label={localAudioPub.track ? 'Track Active' : 'No Track'}
                color={localAudioPub.track ? 'success' : 'error'}
                size="small"
              />
              <Chip
                label={localParticipant.isSpeaking ? 'Speaking' : 'Silent'}
                color={localParticipant.isSpeaking ? 'success' : 'default'}
                size="small"
              />
              <Chip
                label={isCurrentUserSpeaking ? 'Gate: open' : 'Gate: closed'}
                color={isCurrentUserSpeaking ? 'success' : 'default'}
                size="small"
              />
            </>
          ) : (
            <Chip label="NO MIC PUBLICATION" color="error" size="small" />
          )}
        </Box>
      </Box>

      {/* ────────────── Local audio level ────────────── */}
      {localAudioPub && !localAudioPub.isMuted && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ color: 'grey.400' }}>
            Mic Level: {Math.round(audioLevel)}%
          </Typography>
          <Box
            sx={{
              width: '100%',
              height: 8,
              backgroundColor: 'grey.800',
              borderRadius: 1,
              mt: 0.5,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                width: `${audioLevel}%`,
                height: '100%',
                backgroundColor:
                  audioLevel > 50 ? theme.palette.semantic.status.positive : audioLevel > 20 ? theme.palette.warning.main : theme.palette.semantic.status.negative,
                transition: 'width 0.1s',
              }}
            />
          </Box>
        </Box>
      )}

      <Divider sx={{ my: 2, borderColor: 'grey.700' }} />

      {/* ────────────── Remote participants ────────────── */}
      <Typography variant="subtitle2" sx={{ color: 'grey.300', mb: 1 }}>
        Remote Participants ({remoteParticipants.length})
      </Typography>
      {remoteParticipants.length === 0 ? (
        <Typography variant="caption" sx={{ color: 'grey.500' }}>
          No other participants in the room.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {remoteParticipants.map((p) => (
            <RemoteParticipantDiagnostic
              key={p.identity}
              participant={p}
              speaking={speakingMap.get(p.identity) ?? false}
              stats={liveStats.get(p.identity)}
              onForceResubscribe={trackActions?.forceResubscribeMic}
            />
          ))}
        </Stack>
      )}

      <Divider sx={{ my: 2, borderColor: 'grey.700' }} />

      {/* ────────────── Live event log ────────────── */}
      <EventLogSection />

      <Divider sx={{ my: 2, borderColor: 'grey.700' }} />

      <Typography variant="caption" sx={{ color: 'grey.500', display: 'block' }}>
        <strong>Toggle:</strong> Ctrl+Shift+D
      </Typography>
      <Typography variant="caption" sx={{ color: 'grey.500', display: 'block', mt: 0.5 }}>
        If a remote shows <strong>NOT SUBSCRIBED</strong>, <strong>NO TRACK</strong>, or
        attached element count = 0, click <em>Force resubscribe</em> to re-issue the
        subscription. If volume is 0, you may have muted them via the user context menu.
      </Typography>
    </Paper>
  );
};

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Newest-first scrollable feed of LiveKit room events. Sourced from
 * VoiceEventLogProvider (mounted in Layout/MobileLayout/TabletLayout) so the
 * log includes events that fired before the user opened the panel.
 */
const EventLogSection: React.FC = () => {
  const theme = useTheme();
  const log = useVoiceEventLog();
  const [paused, setPaused] = useState(false);
  // Snapshot the events when paused, so the rendered list freezes for inspection.
  const snapshotRef = useRef<VoiceEventEntry[] | null>(null);

  if (!log) {
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ color: 'grey.300', mb: 1 }}>
          Event Log
        </Typography>
        <Typography variant="caption" sx={{ color: 'grey.500' }}>
          (VoiceEventLogProvider not mounted — log unavailable)
        </Typography>
      </Box>
    );
  }

  const displayEvents = paused
    ? snapshotRef.current ?? log.events
    : log.events;

  // Newest-first: render in reverse without mutating the source array.
  const ordered = [...displayEvents].reverse();

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 1,
        }}
      >
        <Typography variant="subtitle2" sx={{ color: 'grey.300' }}>
          Event Log ({log.events.length})
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => {
              if (!paused) snapshotRef.current = log.events;
              setPaused((p) => !p);
            }}
            sx={{ minWidth: 0, px: 1 }}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => {
              log.clear();
              snapshotRef.current = null;
            }}
            sx={{ minWidth: 0, px: 1 }}
          >
            Clear
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          fontFamily: 'monospace',
          fontSize: 11,
          backgroundColor: 'grey.900',
          color: 'grey.100',
          borderRadius: 1,
          maxHeight: 220,
          overflowY: 'auto',
          p: 0.75,
          border: 1,
          borderColor: 'grey.800',
        }}
      >
        {ordered.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'grey.500' }}>
            (no events yet — connection events will appear here)
          </Typography>
        ) : (
          ordered.map((e) => (
            <Box
              key={e.id}
              sx={{
                py: 0.25,
                color: severityColor(e.severity, theme),
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <span style={{ color: theme.palette.grey[500] }}>
                {formatTime(e.timestamp)}
              </span>{' '}
              <span style={{ color: theme.palette.grey[400] }}>
                [{e.category}]
              </span>{' '}
              {e.message}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};

function severityColor(severity: VoiceEventSeverity, theme: Theme): string {
  switch (severity) {
    case 'success':
      return theme.palette.success.light;
    case 'warn':
      return theme.palette.warning.light;
    case 'error':
      return theme.palette.error.light;
    default:
      return theme.palette.grey[200];
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ──────────────────────────────────────────────────────────────────────────────

interface RemoteParticipantDiagnosticProps {
  participant: RemoteParticipant;
  speaking: boolean;
  stats?: LiveStatRow;
  onForceResubscribe?: (identity: string) => void;
}

const RemoteParticipantDiagnostic: React.FC<RemoteParticipantDiagnosticProps> = ({
  participant,
  speaking,
  stats,
  onForceResubscribe,
}) => {
  const theme = useTheme();

  const micPub = findMicPublication(participant);
  const summary = summarizeMicState(micPub);
  const storedVolume = readStoredVolume(participant.identity);

  const cardColor =
    summary.severity === 'error'
      ? alpha(theme.palette.error.main, 0.08)
      : summary.severity === 'warn'
      ? alpha(theme.palette.warning.main, 0.06)
      : alpha(theme.palette.success.main, 0.06);

  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 1,
        backgroundColor: cardColor,
        border: 1,
        borderColor:
          summary.severity === 'error'
            ? theme.palette.error.dark
            : summary.severity === 'warn'
            ? theme.palette.warning.dark
            : 'grey.700',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {participant.name || participant.identity.slice(0, 12)}
        </Typography>
        <Chip
          label={participant.connectionQuality}
          color={qualityColor(participant.connectionQuality)}
          size="small"
        />
      </Box>

      <Typography variant="caption" sx={{ color: 'grey.500', display: 'block', mb: 0.75 }}>
        identity: <code>{participant.identity}</code>
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.75 }}>
        <Chip
          label={micPub ? 'mic published' : 'NO MIC PUB'}
          color={micPub ? 'success' : 'error'}
          size="small"
        />
        {micPub && (
          <>
            <Tooltip title="livekit publication.subscriptionStatus">
              <Chip
                label={`sub: ${micPub.subscriptionStatus}`}
                color={micPub.subscriptionStatus === 'subscribed' ? 'success' : 'error'}
                size="small"
              />
            </Tooltip>
            <Tooltip title="publication.track is set (data is flowing)">
              <Chip
                label={micPub.track ? 'track ✓' : 'track ✗'}
                color={micPub.track ? 'success' : 'error'}
                size="small"
              />
            </Tooltip>
            <Tooltip title="publication.isMuted (sender muted their mic)">
              <Chip
                label={micPub.isMuted ? 'sender muted' : 'sender live'}
                color={micPub.isMuted ? 'warning' : 'default'}
                size="small"
              />
            </Tooltip>
            <Chip
              label={speaking ? 'speaking' : 'silent'}
              color={speaking ? 'success' : 'default'}
              size="small"
            />
            {micPub.track && (
              <>
                <Tooltip title="Number of <audio> elements this track is attached to">
                  <Chip
                    label={`attached: ${micPub.track.attachedElements?.length ?? 0}`}
                    color={(micPub.track.attachedElements?.length ?? 0) > 0 ? 'success' : 'error'}
                    size="small"
                  />
                </Tooltip>
                <Tooltip title="Current playback volume on the audio track">
                  <Chip
                    label={`vol: ${formatVolume(getTrackVolume(micPub))}`}
                    color={
                      getTrackVolume(micPub) === 0
                        ? 'error'
                        : (getTrackVolume(micPub) ?? 1) < 0.05
                        ? 'warning'
                        : 'default'
                    }
                    size="small"
                  />
                </Tooltip>
              </>
            )}
          </>
        )}
      </Box>

      {storedVolume !== null && (
        <Typography variant="caption" sx={{ color: 'grey.500', display: 'block' }}>
          stored localStorage volume: {storedVolume.toFixed(2)}{' '}
          {storedVolume === 0 && (
            <span style={{ color: theme.palette.error.light }}>
              (← user-muted via context menu)
            </span>
          )}
        </Typography>
      )}

      {stats && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.75 }}>
          <Tooltip title="Inbound audio bitrate (derived from byte delta)">
            <Chip
              label={`${stats.bitrateKbps != null ? Math.round(stats.bitrateKbps) : '—'} kbps`}
              color={stats.bitrateKbps && stats.bitrateKbps > 1 ? 'success' : 'warning'}
              size="small"
            />
          </Tooltip>
          <Tooltip title="WebRTC inbound audioLevel (0–1)">
            <Chip label={`lvl: ${formatStat(stats.audioLevel, 3)}`} size="small" />
          </Tooltip>
          <Tooltip title="Total audio energy — increases while audio flows">
            <Chip label={`energy: ${formatStat(stats.totalAudioEnergy, 2)}`} size="small" />
          </Tooltip>
          <Tooltip title="Packets received / lost">
            <Chip
              label={`pkts: ${stats.packetsReceived ?? '—'}/${stats.packetsLost ?? 0} lost`}
              color={(stats.packetsLost ?? 0) > 0 ? 'warning' : 'default'}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Jitter (ms)">
            <Chip label={`jitter: ${formatMs(stats.jitter)}`} size="small" />
          </Tooltip>
          {stats.rtt != null && (
            <Tooltip title="Round-trip time (ms)">
              <Chip label={`rtt: ${formatMs(stats.rtt)}`} size="small" />
            </Tooltip>
          )}
        </Box>
      )}

      <Box sx={{ mt: 0.75, display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <Chip
          label={summary.label}
          color={summary.severity === 'ok' ? 'success' : summary.severity === 'warn' ? 'warning' : 'error'}
          size="small"
          sx={{ flex: 1, justifyContent: 'flex-start' }}
        />
        {onForceResubscribe && (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            onClick={() => onForceResubscribe(participant.identity)}
            disabled={!micPub}
          >
            Force resubscribe
          </Button>
        )}
      </Box>
    </Box>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers

/** Live WebRTC stats row for a remote participant (inbound audio + derived bitrate). */
interface LiveStatRow extends InboundAudioStats {
  bitrateKbps?: number;
}

function formatStat(v: number | undefined, digits: number): string {
  return v == null ? '—' : v.toFixed(digits);
}

function formatMs(seconds: number | undefined): string {
  return seconds == null ? '—' : `${Math.round(seconds * 1000)}`;
}

function findMicPublication(participant: RemoteParticipant): RemoteTrackPublication | undefined {
  for (const [, pub] of participant.trackPublications) {
    if (pub.source === Track.Source.Microphone) return pub as RemoteTrackPublication;
  }
  return undefined;
}

interface MicSummary {
  severity: 'ok' | 'warn' | 'error';
  label: string;
}

function summarizeMicState(micPub: RemoteTrackPublication | undefined): MicSummary {
  if (!micPub) {
    return { severity: 'warn', label: 'No mic published — they may have joined muted' };
  }
  if (micPub.subscriptionStatus !== 'subscribed') {
    return { severity: 'error', label: `Not subscribed (${micPub.subscriptionStatus}) — try Force resubscribe` };
  }
  if (!micPub.track) {
    return { severity: 'error', label: 'Subscribed but no track yet — SFU not forwarding' };
  }
  const attached = micPub.track.attachedElements?.length ?? 0;
  if (attached === 0) {
    return { severity: 'error', label: 'Track present but not attached to any <audio> element' };
  }
  const volume = getTrackVolume(micPub);
  if (volume === 0) {
    return { severity: 'error', label: 'Track volume is 0 (deafened or muted-for-me)' };
  }
  if (micPub.isMuted) {
    return { severity: 'ok', label: 'Healthy — sender is muted' };
  }
  return { severity: 'ok', label: 'Healthy' };
}

function getTrackVolume(pub: RemoteTrackPublication): number | undefined {
  const track = pub.track as { getVolume?: () => number } | undefined;
  if (!track || typeof track.getVolume !== 'function') return undefined;
  try {
    return track.getVolume();
  } catch {
    return undefined;
  }
}

function formatVolume(v: number | undefined): string {
  if (v === undefined) return 'n/a';
  return v.toFixed(2);
}

function readStoredVolume(identity: string): number | null {
  try {
    const raw = localStorage.getItem(`${VOLUME_STORAGE_PREFIX}${identity}`);
    if (raw === null) return null;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function qualityColor(q: ConnectionQuality): 'success' | 'warning' | 'error' | 'default' {
  switch (q) {
    case ConnectionQuality.Excellent:
    case ConnectionQuality.Good:
      return 'success';
    case ConnectionQuality.Poor:
      return 'warning';
    case ConnectionQuality.Lost:
      return 'error';
    default:
      return 'default';
  }
}
