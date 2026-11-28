import { stripBidi } from './bidi';

/** A web link the kit will open: the address to follow and the label to show. */
export interface CheckedLink {
  /** The parsed address (`URL.href`): punycode host, percent-encoded path. */
  href: string;
  /**
   * What is shown: the parsed address as the parser serialises it (protocol, punycode host, percent-encoded path,
   * query and fragment), never decoded, so a space, an invisible character or a bidi control stays `%xx`.
   */
  label: string;
}

/**
 * A link segment's address checked and the label drawn for it; null for an address that is not drawn as a link:
 * anything but http or https, and any address with a user name or password (`https://bank.example@evil.example/`
 * reads as one host and goes to another).
 */
export function checkLink(href: string): CheckedLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const label = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  return { href: url.href, label: stripBidi(label) };
}
