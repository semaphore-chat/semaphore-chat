import { stripBidiOverrides } from "../utils/bidi";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { userControllerGetUserByIdOptions } from "../api-client/@tanstack/react-query.gen";
import type { Message } from "../types/message.type";
import { SpanType } from "../types/message.type";

/** Batch window: qualifying messages arriving within this window of the
 * first one are coalesced into a single announcement. */
const ANNOUNCEMENT_BATCH_WINDOW_MS = 2000;
const PREVIEW_MAX_LENGTH = 80;

interface CachedUserSummary {
  displayName?: string;
  username?: string;
}

/**
 * Flattens a message's spans into a short plain-text preview for the
 * aria-live announcement. Mentions/emoji are rendered as short placeholders
 * rather than resolved (resolving them would need extra lookups the
 * announcer doesn't otherwise need) — good enough for a truncated preview.
 */
export function buildPreviewText(message: Message): string {
  const text = message.spans
    .map((span) => {
      switch (span.type) {
        case SpanType.PLAINTEXT:
        case SpanType.CODE_BLOCK:
        case SpanType.EMOJI:
          return stripBidiOverrides(span.text ?? "");
        case SpanType.SPECIAL_MENTION:
          return `@${stripBidiOverrides(span.specialKind ?? "mention")}`;
        case SpanType.USER_MENTION:
        case SpanType.ALIAS_MENTION:
          return "@mention";
        default:
          return "";
      }
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  if (text) {
    return text.length > PREVIEW_MAX_LENGTH
      ? `${text.slice(0, PREVIEW_MAX_LENGTH).trimEnd()}…`
      : text;
  }
  return message.attachments && message.attachments.length > 0
    ? "Sent an attachment"
    : "New message";
}

export interface UseMessageListAnnouncerOptions {
  /** Chronological (oldest-first) render order — same array VirtualMessageList gets. */
  orderedMessages: Message[];
  /** Whether the list is currently pinned to the live edge (from VirtualMessageList's onAtBottomChange). */
  atBottom: boolean;
  authorId: string;
  /** Channel/DM identity — resets the "seen newest" baseline on context switch. */
  contextKey?: string;
  enabled?: boolean;
}

/**
 * Produces a throttled, coalescing aria-live announcement string for new
 * incoming messages that arrive while the reader is scrolled away from the
 * live edge. Own messages, and messages arriving while already at the
 * bottom (visible without any announcement needed), are silently ignored.
 *
 * Wired off the same `atBottom` signal MessageContainer's FAB/unread logic
 * already uses — no separate detachment tracking.
 */
export function useMessageListAnnouncer({
  orderedMessages,
  atBottom,
  authorId,
  contextKey,
  enabled = true,
}: UseMessageListAnnouncerOptions): string {
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState("");

  // Baseline: the row key (clientId ?? id) of the newest message we've
  // already accounted for. `undefined` means "not yet observed" (initial
  // load / just switched context) — the first observation only records the
  // baseline, it never announces (avoids announcing the whole initial page
  // as if every message in it just arrived).
  const prevNewestKeyRef = useRef<string | undefined>(undefined);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;

  const pendingRef = useRef<Message[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const batch = pendingRef.current;
    pendingRef.current = [];
    if (batch.length === 0) return;

    let text: string;
    if (batch.length === 1) {
      const message = batch[0];
      const cached = message.authorId
        ? queryClient.getQueryData<CachedUserSummary>(
            userControllerGetUserByIdOptions({ path: { id: message.authorId } })
              .queryKey,
          )
        : undefined;
      const author = message.webhook?.name ?? cached?.displayName ?? cached?.username;
      const preview = buildPreviewText(message);
      text = author ? `${author}: ${preview}` : preview;
    } else {
      text = `${batch.length} new messages`;
    }

    // Clear-then-set forces a re-announcement even when the text is
    // identical to the last one — most screen readers only announce
    // aria-live regions on an actual text mutation, not a same-value set.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(text));
  }, [queryClient]);

  // Reset the baseline (and drop any pending batch) on channel/DM switch —
  // otherwise the first message of a freshly loaded context would look like
  // "a new incoming message" the moment it loads.
  useEffect(() => {
    prevNewestKeyRef.current = undefined;
    pendingRef.current = [];
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, [contextKey]);

  useEffect(() => {
    if (!enabled) return;
    const newest = orderedMessages[orderedMessages.length - 1];
    const newestKey = newest ? (newest.clientId ?? newest.id) : undefined;

    if (prevNewestKeyRef.current === undefined) {
      prevNewestKeyRef.current = newestKey;
      return;
    }
    if (newestKey === undefined || newestKey === prevNewestKeyRef.current) return;

    // Find everything appended since the last observed newest message so a
    // burst of several messages between two renders is counted accurately,
    // not just the single latest one. If the previous newest fell out of
    // the loaded window (evicted at the pagination cap), fall back to
    // treating only the current newest as new.
    const prevIndex = orderedMessages.findIndex(
      (m) => (m.clientId ?? m.id) === prevNewestKeyRef.current,
    );
    const newTail =
      prevIndex === -1 ? (newest ? [newest] : []) : orderedMessages.slice(prevIndex + 1);
    prevNewestKeyRef.current = newestKey;

    if (atBottomRef.current) return;
    const incoming = newTail.filter((m) => m.authorId !== authorId);
    if (incoming.length === 0) return;

    pendingRef.current.push(...incoming);
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flush, ANNOUNCEMENT_BATCH_WINDOW_MS);
    }
  }, [orderedMessages, authorId, enabled, flush]);

  useEffect(
    () => () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    },
    [],
  );

  return announcement;
}
