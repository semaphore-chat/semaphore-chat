import {
  signIssuedAt,
  signSessionId,
  verifyIssuedAt,
  verifySessionId,
} from './livekit-token-attributes.util';

describe('livekit-token-attributes.util', () => {
  const secret = 'livekit-secret';
  const issuedAt = 1_760_000_000_123;

  it('round-trips the issue time for the same identity and secret', () => {
    const value = signIssuedAt(secret, 'user-1', issuedAt);

    expect(value.startsWith(`${issuedAt}.`)).toBe(true);
    expect(verifyIssuedAt(secret, 'user-1', value)).toBe(issuedAt);
  });

  it("rejects another identity's value (no copying a signed attribute)", () => {
    const value = signIssuedAt(secret, 'user-2', issuedAt);

    expect(verifyIssuedAt(secret, 'user-1', value)).toBeNull();
  });

  it('rejects a changed issue time (no forging a later token)', () => {
    const [, mac] = signIssuedAt(secret, 'user-1', issuedAt).split('.');

    expect(
      verifyIssuedAt(secret, 'user-1', `${issuedAt + 60_000}.${mac}`),
    ).toBeNull();
  });

  it('rejects a value signed with another secret', () => {
    const value = signIssuedAt('other-secret', 'user-1', issuedAt);

    expect(verifyIssuedAt(secret, 'user-1', value)).toBeNull();
  });

  it.each([
    undefined,
    '',
    String(issuedAt),
    `${issuedAt}.`,
    `abc.def`,
    `${issuedAt}.not valid!`,
    `99999999999999999.abc`,
  ])('rejects a missing or malformed value (%p)', (value) => {
    expect(verifyIssuedAt(secret, 'user-1', value)).toBeNull();
  });

  describe('session id', () => {
    const sid = '6f1c2a4e-3b7d-4c55-9a0e-2f8d1b6c9e01';

    it('round-trips the session id for the same identity and secret', () => {
      const value = signSessionId(secret, 'user-1', sid);

      expect(verifySessionId(secret, 'user-1', value)).toBe(sid);
    });

    it("rejects another identity's value", () => {
      expect(
        verifySessionId(secret, 'user-1', signSessionId(secret, 'user-2', sid)),
      ).toBeNull();
    });

    it('rejects a changed session id (forged)', () => {
      const [, sig] = signSessionId(secret, 'user-1', sid).split('.');

      expect(
        verifySessionId(secret, 'user-1', `other-session.${sig}`),
      ).toBeNull();
    });

    it('rejects an issue-time value presented as a session (and vice versa)', () => {
      const issued = signIssuedAt(secret, 'user-1', issuedAt);
      const session = signSessionId(secret, 'user-1', String(issuedAt));

      expect(verifySessionId(secret, 'user-1', issued)).toBeNull();
      expect(verifyIssuedAt(secret, 'user-1', session)).toBeNull();
    });

    it.each([undefined, '', sid, `${sid}.`, '.abc', `a b.abc`])(
      'rejects a missing or malformed value (%p)',
      (value) => {
        expect(verifySessionId(secret, 'user-1', value)).toBeNull();
      },
    );
  });
});
