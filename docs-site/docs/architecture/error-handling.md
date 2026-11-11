# Error Handling

Every error a client can receive carries a stable code, on REST and on sockets. Clients should decide what to do from the code, and show `message` to people.

## REST

Every error response has this body (`ErrorResponseDto`, documented as the `default` response of every operation in the OpenAPI spec):

```json
{
  "statusCode": 403,
  "message": "Slowmode is enabled. Please wait 30 seconds before sending another message.",
  "error": "Forbidden",
  "errorCode": "SLOWMODE",
  "retryable": true,
  "retryAfterMs": 30000
}
```

| Field | Meaning |
|---|---|
| `statusCode`, `message`, `error` | NestJS's standard fields. `message` is an array for DTO validation failures. `error` isn't always present |
| `errorCode` | A value of `ErrorCode` (`shared/src/errors/error-codes.enum.ts`) |
| `retryable` | Whether a client may retry the same request automatically. `TIMED_OUT` is `false`: a moderation timeout can last for weeks |
| `retryAfterMs` | How long until the same request can succeed, when the server knows. `TIMED_OUT` sets it for display, not as an invitation to retry |

## Sockets

A failed event sends an `exception` event to the socket:

```json
{
  "status": "error",
  "message": "Quoted message not found",
  "errorCode": "QUOTE_NOT_FOUND",
  "retryable": false,
  "cause": { "pattern": "sendMessage", "data": {} }
}
```

A payload that fails DTO validation is the one exception to this shape: it stays a plain array of class-validator errors, because that's what existing clients read.

`cause.data` is the payload the client sent. An unexpected error is always reported as `Internal server error` with `INTERNAL`, so details never reach clients.

## Sending a message

`SEND_MESSAGE`, `SEND_DM` and `SEND_THREAD_REPLY` can answer with a typed ack. A client asks for it by connecting with `auth: { token, protocol: 2 }`:

```json
{ "ok": true, "messageId": "..." }
{ "ok": false, "error": { "errorCode": "SLOWMODE", "message": "...", "retryable": true, "retryAfterMs": 30000 } }
```

The failure arrives right away, so a client doesn't have to wait out a timeout. The `exception` event still fires too. A client without `protocol` gets the plain message id on success and only the `exception` event on failure, as it always did.

### Retrying safely

Any send, on a socket or over REST (`POST /messages`, `POST /messages/dm`, `POST /threads/:id/replies`), can carry a `clientNonce`: a UUID the client makes for this message. The message and its broadcast carry it back, which is how the sender recognises its own message.

A client that lost an ack, or was suspended mid-send, retries with the same nonce:

| The message... | The retry gets |
|---|---|
| was created | The same message. Nothing is sent again or announced again, and slowmode doesn't apply |
| was deleted, by anyone | `MESSAGE_DELETED` (410). Stop retrying and drop the local copy |
| was never created | A new send, with the usual checks |
| exists somewhere else (same nonce, another channel) | `NONCE_CONFLICT` (409). This is a client bug |

Nonces belong to the sender: two users using the same one don't interact.

## Rules for the codes

**For clients:** expect codes you don't know. A newer server can send them to an older client, so handle an unknown code by `retryable` and the status, and show `message`.

**For the server:** `ErrorCode` is append-only. A released code is never renamed, reused or given a new meaning.

## Adding a code

Nothing has to change for an error to have a code: `ApiExceptionFilter` and `WsLoggingExceptionFilter` give every exception a generic one from its status. Add a specific code when a client needs to tell that error apart from others:

1. Add it to `ErrorCode`, and to `RETRYABLE_CODES` in `backend/src/common/errors/error-fields.ts` if a client should retry it automatically.
2. Pass it where the error is thrown. Keep the `description`, which is the `error` field clients already get:

```typescript
throw new ForbiddenException('Cannot quote a message from a different channel', {
  description: 'Forbidden',
  errorCode: ErrorCode.QUOTE_OTHER_CONTEXT,
});
```

3. If the wait is known, use the object form to include `retryAfterMs`, with `statusCode` and `error` written out:

```typescript
throw new ForbiddenException({
  statusCode: 403,
  message,
  error: 'Forbidden',
  errorCode: ErrorCode.SLOWMODE,
  retryAfterMs,
});
```

4. Regenerate the OpenAPI spec and client: see the [OpenAPI commands in CLAUDE.md](https://github.com/semaphore-chat/semaphore-chat/blob/main/CLAUDE.md#openapi-sdk-client-regeneration).
