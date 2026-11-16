/**
 * Message Utilities
 *
 * Helper functions for message component logic.
 */

import type { Message as MessageType } from "../../types/message.type";
import { SpanType } from "../../types/message.type";

/**
 * Check if a message mentions the specified user
 * Returns true if the message contains a direct @mention, @here/@channel, or alias group mention
 *
 * @param message - The message to check
 * @param userId - The user ID to check for mentions
 * @param userAliasGroupIds - Optional array of alias group IDs the user belongs to
 */
export function isUserMentioned(
  message: MessageType,
  userId: string | undefined,
  userAliasGroupIds?: string[]
): boolean {
  if (!userId) return false;

  return message.spans.some(span => {
    // Direct user mention
    if (span.type === SpanType.USER_MENTION && span.userId === userId) {
      return true;
    }
    // Special mentions (@here, @channel)
    if (span.type === SpanType.SPECIAL_MENTION && (span.specialKind === 'here' || span.specialKind === 'channel')) {
      // User is mentioned by @here/@channel if they are in the channel
      // For now, we'll assume they are since they can see the message
      return true;
    }
    // Alias group mention - check if user is in the mentioned group
    if (span.type === SpanType.ALIAS_MENTION && span.aliasId) {
      // If we have the user's alias group IDs, check for membership
      if (userAliasGroupIds && userAliasGroupIds.includes(span.aliasId)) {
        return true;
      }
      // If we don't have the info, we can't determine membership
      // The backend handles the actual notification
    }
    return false;
  });
}

// Giphy and Tenor serve GIFs from numbered CDN subdomains (media0.giphy.com,
// media1.tenor.com, ...) as well as the bare `media.<host>.com` form.
const GIPHY_HOSTNAME_PATTERN = /^media\d*\.giphy\.com$/i;
const TENOR_HOSTNAME_PATTERN = /^media\d*\.tenor\.com$/i;
const GIF_PATHNAME_PATTERN = /\.gif$/i;

/**
 * When `content` is EXACTLY one http(s) URL (no surrounding text, no second
 * URL) that points at GIF media — a Giphy/Tenor media CDN host, or any host
 * whose path ends in `.gif` — returns that URL string. Otherwise returns
 * null. Never throws on malformed input.
 *
 * Used to detect Discord-style GIF messages (sent whole-cloth by the GIF
 * picker as `gif.url` — see MessageInput's `handleGifSelect`) so they can be
 * rendered as an inline embed instead of raw link text + a link-preview card.
 */
export function getLoneGifUrl(content: string | undefined | null): string | null {
  const text = content?.trim();
  if (!text) return null;

  // A lone URL never contains whitespace. Bailing out here also prevents a
  // footgun below: `new URL()` doesn't reject a string like "look at this
  // https://media.giphy.com/x.gif" — it silently percent-encodes the spaces
  // into the pathname instead of throwing, which would otherwise defeat the
  // "URL plus other text" exclusion.
  if (/\s/.test(text)) return null;

  // Guard against a second URL glued on with no separating whitespace
  // (e.g. two URLs back to back) — `new URL()` alone wouldn't catch this
  // either, since everything after the first URL just becomes more path.
  const schemeOccurrences = text.match(/https?:\/\//gi);
  if (!schemeOccurrences || schemeOccurrences.length !== 1) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const hostname = url.hostname.toLowerCase();
  const isGifHost =
    GIPHY_HOSTNAME_PATTERN.test(hostname) || TENOR_HOSTNAME_PATTERN.test(hostname);
  const isGifPath = GIF_PATHNAME_PATTERN.test(url.pathname);

  if (!isGifHost && !isGifPath) return null;

  return text;
}

/**
 * Message-level convenience wrapper around `getLoneGifUrl`: reconstructs the
 * message's plain-text content (when it's representable as one) and runs the
 * lone-GIF-URL check against it.
 *
 * Content lives in `message.spans`, not a raw string field, so this only
 * treats the message as a URL candidate when it's exactly one non-code
 * PLAINTEXT span with no attachments — mirroring how the GIF picker actually
 * sends messages (`sendMessageContent(gif.url, [])`, a single plaintext
 * span). Inline code (`` `url` ``) is deliberately excluded: that's the
 * user's way of asking to see the raw URL, not hide it. Any other shape
 * (extra text, multiple spans, an attachment) is not a lone GIF URL.
 */
export function getMessageLoneGifUrl(message: MessageType): string | null {
  if (message.attachments.length > 0) return null;
  if (message.spans.length !== 1) return null;

  const [span] = message.spans;
  if (span.type !== SpanType.PLAINTEXT) return null;
  if (span.code === true) return null;

  return getLoneGifUrl(span.text);
}
