# Auth Clients

How a client signs in, stores its refresh token and stays signed in. This is
the contract for anything that talks to the API: the web app, the Electron app,
and native desktop or mobile clients. The OpenAPI spec describes the same
headers and fields per endpoint.

## Client types

A client says what it is with the `X-Client-Type` header:

| Value | Client | Refresh token |
|---|---|---|
| `web`, or no header, or an unknown value | A web browser | `refresh_token` cookie (httpOnly, SameSite=Strict) |
| `electron` | The Electron desktop app | Response body |
| `desktop-native` | A native desktop app | Response body, no cookies |
| `mobile-native` | A native mobile app | Response body, no cookies |

The web app doesn't send the header. A client that gets its refresh token in
the body stores it itself (OS keychain, iOS Keychain, Android Keystore) and
sends it back in the body. The token is an opaque string to the client, and
gets replaced on every refresh.

## Headers

| Header | Who | What |
|---|---|---|
| `X-Client-Type` | Non-web clients | See above |
| `X-Device-Id` | Every client; required for native | A random UUID generated once per install and kept. A new sign-in replaces the sessions of the same install, and a refresh within the grace window must come from the same id |
| `User-Agent` | Every client; required for native | Compared, exactly, when a rotated token is presented again within the grace window, so keep it stable between requests |
| `X-Device-Name` | Native, optional | The name in the owner's sessions list, as percent-encoded UTF-8. The server takes out control and format characters and angle brackets and caps it at 64 characters. It is user-supplied: don't log it or render it unescaped |

A native client without `X-Device-Id` or a `User-Agent` gets a 400, before a
sign-in code is spent.

## Signing in

`POST /auth/login` and `POST /auth/desktop/token` answer with `accessToken`
and, for a client that gets body delivery, `refreshToken`.

**Sign in with browser** is PKCE: the client creates a verifier, sends the user
to `/#/desktop-login` in the system browser with its challenge, gets a
single-use code back and redeems it with the verifier at
`POST /auth/desktop/token`. The endpoints know nothing about how the code gets
back to the client. Today the page only redirects to a loopback listener
(`http://127.0.0.1:<port>/callback`, RFC 8252 section 7.3). A mobile client
needs another target (a custom scheme or an app link, from a system browser
session); it will be a fixed callback chosen by the page, never a URL taken
from the link.

## Refreshing

`POST /auth/refresh` takes the token from the body or the cookie:

| Request | Used | Answer |
|---|---|---|
| Cookie only | The cookie | New cookies. **Never** a refresh token in the body, whatever the headers say |
| Valid token in the body (with or without a cookie) | The body token | The new refresh token in the body |
| Invalid token in the body (with or without a cookie) | Nothing | 401. The cookie isn't tried |

## Logging out and sessions

`POST /auth/logout` takes the access token, and the refresh token from the
cookie or the body. `GET /auth/sessions` and `DELETE /auth/sessions` find the
current session from the refresh cookie or, without one, the access token's
`sid`. WebSocket authentication and `REAUTHENTICATE` use the access token and
are the same for every client type; send it in the `Authorization` header
rather than the `token` query parameter, which ends up in access logs.

## Older servers and clients

- **A native client on a server from before this contract** gets no
  `refreshToken` from a sign-in. It should tell the user that the server is too
  old, and must not pretend to be something else.
- **The Electron app on an older server** works: it keeps its default user
  agent, and the server ignores the new header.
- **Electron builds from before the header on a newer server** work: a sign-in
  from an `Electron` user agent counts as `electron`. That fallback goes away
  in a later release, when those builds are gone.

## What protects the refresh token

Script in a web page (XSS) must not get a browser's refresh token. What
prevents that:

1. **The cookie is httpOnly, and a cookie refresh never answers in the body.**
   A page can't read the cookie, so it has no token to put in a request body.
   This is the protection, and it doesn't depend on any header.
2. **A sign-in needs a password or a PKCE code.** Whoever has one of those can
   redeem it from any machine, so body delivery on these endpoints gives script
   in a page nothing new.

### The header checks are defense in depth

`X-Client-Type` is a request, not proof. On top of the above, the sign-in
endpoints don't give body delivery to a request that visibly comes from a web
page: an `http(s)` `Origin`, or `Sec-Fetch-Site: same-origin` or `same-site`
(`isBrowserPageRequest`). Native clients also can't have any `Origin` or
`Sec-Fetch-*` header. **This is not a security boundary**, and nothing should
rely on it:

- Firefox lets page script forge `User-Agent`, and a same-origin `fetch` with
  `mode: 'same-origin'` and `referrerPolicy: 'no-referrer'` sends `Origin: null`
  there. Chromium does neither. `frontend/e2e/auth-token-delivery.spec.ts` pins
  this per browser. `Origin: null` passes the check for `electron`, in case
  builds in the field send it; the current packaged app sends no `Origin` at
  all, and `Sec-Fetch-Site: cross-site` where fetch metadata is sent
  (`frontend/scripts/electron-smoke/smoke.ts` pins that).
- `Sec-Fetch-Site` catches that case only where browsers send it: HTTPS and
  localhost. On an instance served over plain HTTP, Firefox page script gets
  past the check.
- Web views get no exception: a mobile app built on one has an `http(s)`
  `Origin` and gets cookies.

### What this doesn't cover

- Script in the Electron renderer can ask the preload bridge for the stored
  token.
- `POST /auth/desktop/authorize` approves a sign-in with the page's access
  token, so script in a page can start a session of its own that way.
