/**
 * Voice events the renderer writes to the desktop app's log file (via the
 * `voice:log` IPC). The renderer is untrusted input to the main process, so
 * entries are validated and size-capped here before they reach the log.
 */

export type VoiceLogLevel = 'info' | 'warn' | 'error';

export interface VoiceLogEntry {
  level: VoiceLogLevel;
  /** Short event name, e.g. "join-failed". */
  event: string;
  /** Small JSON-able details (no media, no message content). */
  data?: Record<string, unknown>;
}

export const VOICE_LOG_EVENT_MAX = 64;
export const VOICE_LOG_DATA_MAX = 2000;

const LEVELS: readonly VoiceLogLevel[] = ['info', 'warn', 'error'];

/** A loggable line for a renderer entry, or null to drop it. */
export function formatVoiceLogEntry(raw: unknown): { level: VoiceLogLevel; line: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { level, event, data } = raw as Partial<VoiceLogEntry>;
  if (!LEVELS.includes(level as VoiceLogLevel)) return null;
  if (typeof event !== 'string' || event.length === 0) return null;

  let details = '';
  if (data !== undefined) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    try {
      details = JSON.stringify(data);
    } catch {
      return null;
    }
    if (details.length > VOICE_LOG_DATA_MAX) {
      details = `${details.slice(0, VOICE_LOG_DATA_MAX)}…`;
    }
  }

  const name = event.slice(0, VOICE_LOG_EVENT_MAX).replace(/[^\w:.-]/g, '_');
  return { level: level as VoiceLogLevel, line: details ? `${name} ${details}` : name };
}
