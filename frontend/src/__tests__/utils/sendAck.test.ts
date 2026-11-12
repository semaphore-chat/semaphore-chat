import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@semaphore-chat/shared";
import type { Socket } from "socket.io-client";
import {
  describeSendFailure,
  emitSend,
  isDeletedWhileSending,
  newSendIdentity,
  readSendAck,
  SEND_ACK_TIMEOUT_MS,
  SendFailedError,
} from "../../utils/sendAck";

const failure = (errorCode: string, message = "from the server") =>
  new SendFailedError(errorCode, message);

describe("readSendAck", () => {
  it("reads the plain id an older server acks", () => {
    expect(readSendAck("msg-1")).toEqual({ success: true, messageId: "msg-1" });
  });

  it("reads a typed success", () => {
    expect(readSendAck({ ok: true, messageId: "msg-1" })).toEqual({
      success: true,
      messageId: "msg-1",
    });
  });

  it("reads a typed failure, with its code and message", () => {
    const { success, error } = readSendAck({
      ok: false,
      error: {
        errorCode: ErrorCode.SLOWMODE,
        message: "Wait",
        retryable: true,
        retryAfterMs: 5000,
      },
    });

    expect(success).toBe(false);
    expect(error).toBeInstanceOf(SendFailedError);
    expect(error).toMatchObject({
      errorCode: ErrorCode.SLOWMODE,
      message: "Wait",
    });
  });
});

describe("emitSend", () => {
  let ack: ((answer: unknown) => void) | undefined;
  const socket = {
    emit: vi.fn((_event: string, _payload: unknown, fn: (a: unknown) => void) => {
      ack = fn;
    }),
  } as unknown as Socket;

  beforeEach(() => {
    vi.useFakeTimers();
    ack = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles as soon as the server answers", async () => {
    const send = emitSend(socket, "sendMessage", {});
    ack!({
      ok: false,
      error: { errorCode: "FORBIDDEN", message: "No", retryable: false },
    });
    await expect(send).resolves.toMatchObject({ success: false });
  });

  it("times out when no answer comes, and ignores a late one", async () => {
    const send = emitSend(socket, "sendMessage", {});
    vi.advanceTimersByTime(SEND_ACK_TIMEOUT_MS);
    const result = await send;
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/timed out/);
    expect(() => ack!("msg-1")).not.toThrow();
  });
});

describe("describeSendFailure", () => {
  it("shows a server message written for people", () => {
    expect(
      describeSendFailure(failure(ErrorCode.SLOWMODE, "Slowmode is on")),
    ).toBe("Slowmode is on");
  });

  it("shows the server message for a code this client does not know", () => {
    expect(describeSendFailure(failure("BRAND_NEW", "Something new"))).toBe(
      "Something new",
    );
  });

  it("rewords refusals that read badly as sent", () => {
    expect(
      describeSendFailure(failure(ErrorCode.FORBIDDEN, "Forbidden resource")),
    ).toBe("You can't send messages here");
    expect(
      describeSendFailure(failure(ErrorCode.DM_BLOCKED, "You cannot message this user")),
    ).toBe("You can't send messages here");
    expect(describeSendFailure(failure(ErrorCode.INTERNAL, "Internal"))).toBe(
      "Failed to send",
    );
  });

  it("has a default for a timeout or no error", () => {
    expect(describeSendFailure(new Error("timed out"))).toBe("Failed to send");
    expect(describeSendFailure(undefined)).toBe("Failed to send");
  });
});

describe("isDeletedWhileSending", () => {
  it("recognises only the deleted code", () => {
    expect(isDeletedWhileSending(failure(ErrorCode.MESSAGE_DELETED))).toBe(true);
    expect(isDeletedWhileSending(failure(ErrorCode.FORBIDDEN))).toBe(false);
    expect(isDeletedWhileSending(new Error("x"))).toBe(false);
    expect(isDeletedWhileSending(undefined)).toBe(false);
  });
});

describe("newSendIdentity", () => {
  it("makes the row id from the nonce, new each time", () => {
    const first = newSendIdentity("pending-");
    expect(first.clientId).toBe(`pending-${first.clientNonce}`);
    expect(newSendIdentity("pending-").clientNonce).not.toBe(first.clientNonce);
  });

  it("works without crypto.randomUUID (plain HTTP)", () => {
    const own = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    try {
      const { clientNonce, clientId } = newSendIdentity("pending-");
      expect(clientNonce).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(clientId).toBe(`pending-${clientNonce}`);
    } finally {
      if (own) Object.defineProperty(crypto, "randomUUID", own);
      else delete (crypto as { randomUUID?: unknown }).randomUUID;
    }
  });
});
