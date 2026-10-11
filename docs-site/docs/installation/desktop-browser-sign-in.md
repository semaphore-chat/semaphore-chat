# Sign in with browser (desktop app)

The desktop app can sign you in through your web browser, so you can use the
browser's password manager, or the session you already have there, instead of
typing your password into the app.

## Using it

1. Start the desktop app. On first launch, enter your server's URL; the last
   step of the wizard offers **Sign in with browser** (or use the button at the
   top of the login screen later).
2. Your browser opens your server's sign-in page. Sign in as usual. If you are
   already signed in in that browser, this step is skipped.
3. The page asks **Sign in to the desktop app?** and shows the account it will
   use. Choose **Sign in to the desktop app**. If it shows the wrong account,
   choose **Sign out and use another account**.
4. The browser hands the sign-in back to the app and says you can close the
   tab. The app is now signed in.

The app waits up to 10 minutes for the browser. **Cancel** in the app, or
**Cancel** on the browser page, stops it. The login screen also shows which
server the app uses, with **Change server** to pick another one.

The password form stays on the login screen below the button, and is the only
option for servers older than this feature (the app hides the button for them).

## What admins need to know

- **Same address for the web app and the API.** The app opens
  `<server URL>/#/desktop-login` and talks to `<server URL>/api`, so the web
  app and the API must be served from the same base URL, as the Docker Compose
  and Helm setups do.
- **Nothing to configure.** No new environment variables, ports or redirect
  URLs. The browser hands the sign-in back to the app on
  `http://127.0.0.1:<random port>` (the loopback address of the user's own
  computer), so it doesn't depend on the `semaphore://` link handler being
  registered with the operating system.
- **Sessions.** The desktop app gets a session of its own, listed under
  **Settings → Sessions** as "Semaphore Chat Desktop", which can be signed out
  like any other. Signing in through the browser also leaves the browser signed
  in, as any web sign-in does.

## How it works

It is the OAuth 2.0 authorization code flow with PKCE for native apps
([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252), [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)),
between the app and its own server:

1. The app makes a random secret (the PKCE *verifier*) that never leaves it,
   starts a one-shot listener on `127.0.0.1`, and opens
   `<server URL>/#/desktop-login?challenge=<SHA-256 of the verifier>&state=…&port=…`.
2. After the user confirms, the page calls `POST /api/auth/desktop/authorize`
   with the challenge. The server stores a single-use grant in Redis, bound to
   the challenge, the user and the browser session that approved it, for 60
   seconds, and returns its code.
3. The page sends the browser to `http://127.0.0.1:<port>/callback?code=…&state=…`.
4. The app calls `POST /api/auth/desktop/token` with the code and the
   verifier, and gets its own access and refresh tokens.

What protects it:

- **The code alone is useless.** Redeeming it needs the verifier, which only
  the app that started the sign-in has. A code is redeemed at most once (right
  or wrong verifier), and expires after 60 seconds.
- **No silent approval.** The page always asks first and names the account.
  Approving needs the access token in the `Authorization` header, which another
  site can't send, and a link someone sends you can't sign anything in: the
  code only ever goes to `127.0.0.1` on the computer that opened the link,
  where no app is waiting for it.
- **No open redirect.** The page only ever redirects to
  `http://127.0.0.1:<port>/callback`; the link chooses the port, nothing else.
  The app's listener answers only that path, on `127.0.0.1` exactly (not
  another hostname pointed at it), with the `state` of the sign-in it is
  waiting for.
- **The approval must still stand.** If the browser session that approved it
  signs out or is revoked, the password is reset, or the account is banned
  before the app redeems the code, the server refuses it.
- **Rate limits** apply to both endpoints, like the password sign-in.

The approved grant is the first use of a generic device sign-in grant
(`DeviceLoginGrantService`), which a later QR-code sign-in will reuse.
