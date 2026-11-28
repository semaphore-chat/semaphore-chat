import { isIP } from 'node:net';

/**
 * `PUSH_PRIVATE_HOSTS`: the push service hosts an operator lets push
 * endpoints reach on a private network (a self-hosted ntfy on the LAN or a
 * Tailscale tailnet, for UnifiedPush). Comma-separated exact host names, each
 * with an optional `:port`. Push endpoints are refused for every other
 * non-public host, as before.
 *
 * It relaxes an SSRF guard, so it is an operator setting (environment), read
 * once at boot, not something an admin account can change.
 */
export const PUSH_PRIVATE_HOSTS = Symbol('PUSH_PRIVATE_HOSTS');

export const MAX_PUSH_PRIVATE_HOSTS = 20;

/** One DNS label: letters, digits and inner hyphens, 1 to 63 characters. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface PushPrivateHost {
  host: string;
  /** A port this entry allows besides 443, or null for 443 only. */
  port: number | null;
}

export class PushPrivateHosts {
  private readonly hosts: ReadonlySet<string>;
  private readonly hostPorts: ReadonlySet<string>;

  constructor(readonly entries: readonly PushPrivateHost[] = []) {
    this.hosts = new Set(entries.map((entry) => entry.host));
    this.hostPorts = new Set(
      entries
        .filter((entry) => entry.port !== null)
        .map((entry) => `${entry.host}:${entry.port}`),
    );
  }

  /** Whether this host may resolve to private-network addresses. */
  allowsHost(hostname: string): boolean {
    return this.hosts.has(hostname.toLowerCase());
  }

  /**
   * Whether a push endpoint may use this port on this host: 443 always, any
   * other port only where an entry names it.
   */
  allowsPort(hostname: string, port: number): boolean {
    return (
      port === 443 || this.hostPorts.has(`${hostname.toLowerCase()}:${port}`)
    );
  }
}

/** Why an entry is refused, or null when it is a valid host name. */
function hostProblem(host: string): string | null {
  if (host.includes('*')) return 'wildcards are not supported';
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) {
    return 'IP addresses are not supported, use a host name';
  }
  if (host.length > 253) return 'the host name is too long';
  if (!host.split('.').every((label) => LABEL.test(label))) {
    return 'not a valid host name';
  }
  return null;
}

/**
 * Parses `PUSH_PRIVATE_HOSTS`. Every problem is returned (not thrown), so
 * boot validation can report them together with the other env errors.
 */
export function parsePushPrivateHosts(raw: string | undefined): {
  hosts: PushPrivateHosts;
  errors: string[];
} {
  const errors: string[] = [];
  const entries: PushPrivateHost[] = [];
  const seen = new Set<string>();

  const items = (raw ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (items.length > MAX_PUSH_PRIVATE_HOSTS) {
    errors.push(
      `PUSH_PRIVATE_HOSTS lists ${items.length} hosts; at most ${MAX_PUSH_PRIVATE_HOSTS} are allowed`,
    );
  }

  for (const item of items.slice(0, MAX_PUSH_PRIVATE_HOSTS)) {
    // An IPv6 literal has colons of its own: refuse it as an IP, not a port
    const portMatch = /^([^:]+):(\d{1,5})$/.exec(item);
    const host = portMatch ? portMatch[1] : item;
    const port = portMatch ? Number(portMatch[2]) : null;

    const problem =
      hostProblem(host) ??
      (port !== null && (port < 1 || port > 65535)
        ? 'the port must be 1 to 65535'
        : null);
    if (problem) {
      errors.push(`PUSH_PRIVATE_HOSTS entry "${item}": ${problem}`);
      continue;
    }

    const key = `${host}:${port ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ host, port: port === 443 ? null : port });
  }

  return { hosts: new PushPrivateHosts(entries), errors };
}
