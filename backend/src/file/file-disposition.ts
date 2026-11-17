export const FALLBACK_MIME_TYPE = 'application/octet-stream';

/** CSP for stored-file responses: a directly opened file cannot run script or load anything. */
export const STORED_FILE_CSP = "default-src 'none'; sandbox";

const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** Lowercase `type/subtype` without parameters or whitespace; anything invalid becomes octet-stream. */
export function normaliseMimeType(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return FALLBACK_MIME_TYPE;
  const base = raw.split(';')[0].replace(/\s+/g, '').toLowerCase();
  return MIME_TYPE_PATTERN.test(base) ? base : FALLBACK_MIME_TYPE;
}

const ATTACHMENT_TYPES = new Set([
  'image/svg+xml',
  'image/svg',
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  'text/xsl',
  'application/javascript',
  'text/javascript',
  FALLBACK_MIME_TYPE,
]);

/** Script-capable or unparseable types are forced to download; everything else keeps rendering inline. */
export function dispositionFor(
  mimeType: string | null | undefined,
): 'inline' | 'attachment' {
  const type = normaliseMimeType(mimeType);
  if (ATTACHMENT_TYPES.has(type) || type.endsWith('+xml')) return 'attachment';
  return 'inline';
}
