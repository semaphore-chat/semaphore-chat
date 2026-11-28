# Push notifications

Semaphore Chat sends standard Web Push (RFC 8030, with VAPID and RFC 8291 encryption). The server talks to each user's own push service directly. The project runs no push relay and no hosted service of any kind.

- **Browsers and the installed web app (PWA)** use the push service built into the browser (Mozilla's for Firefox, Google's for Chrome, Apple's for Safari).
- **The native Android app** uses [UnifiedPush](https://unifiedpush.org): a distributor app on the phone, such as [ntfy](https://ntfy.sh), gives the app a Web Push endpoint, and the server pushes to it like to any browser. Without a distributor, the app keeps its own connection open with a foreground service instead.

The VAPID keys are generated on first start, or read from `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (see [Configuration](configuration.md#push-notifications-vapid)).

## What a push service can see

The notification itself (title, the first 100 characters of the message, which conversation it belongs to) is encrypted on the server for the receiving device, with that device's own key. The push service, whether a browser vendor's or a UnifiedPush distributor's server such as ntfy.sh, cannot read it. It does see:

- the endpoint (for ntfy, the topic) the server posts to;
- when each push is sent, and how big it is;
- your server's IP address;
- the VAPID claims: the push service's own address and your `VAPID_SUBJECT` contact (`mailto:admin@localhost` unless you set one);
- the TTL (24 hours) and urgency headers: `high` for direct messages, mentions and replies, `normal` for other channel messages.

Users choose their own distributor. If they would rather no third party saw even that, they can point the ntfy app at a self-hosted ntfy server instead of ntfy.sh.

## Self-hosted ntfy on a private network

By default the server only posts to push services on the public internet: a push endpoint is a URL a user supplies, and the same SSRF guard as link previews refuses anything that resolves to a private, loopback or link-local address. An ntfy server on your LAN, or on a Tailscale tailnet (100.64.0.0/10), is refused.

To allow one, list its host name in `PUSH_PRIVATE_HOSTS`:

```bash
# Comma-separated exact host names, each with an optional :port
PUSH_PRIVATE_HOSTS=ntfy.home.arpa,ntfy.tail1234.ts.net:8443
```

The rules:

| | |
|---|---|
| **Matching** | Exact host names, case-insensitive. No wildcards, no IP addresses. At most 20 entries. |
| **Addresses** | A listed host may resolve to private networks: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 and fc00::/7. Loopback, link-local (including the 169.254.169.254 metadata service) and every other reserved range stay refused for every host, listed or not. |
| **Ports** | 443 always. Another port only where the entry names it (`host:8443`). |
| **Scheme** | HTTPS only, with a certificate the backend trusts. Give the ntfy server a real certificate (DNS-01 challenges work for private hosts, and Tailscale issues certificates for `*.ts.net` names), or add your own CA with `NODE_EXTRA_CA_CERTS`. Plain-HTTP ntfy cannot be used. |
| **When it applies** | Read once at startup; restart the backend after changing it. A bad entry stops the backend from starting, with the reason. Subscriptions on a port you remove are dropped at their next push. |

It is an environment variable, not an admin setting, on purpose: it loosens an SSRF guard, so it belongs to whoever runs the server, not to any admin account.

With Helm, set it through `backend.extraEnv`:

```yaml
backend:
  extraEnv:
    - name: PUSH_PRIVATE_HOSTS
      value: "ntfy.home.arpa"
```
