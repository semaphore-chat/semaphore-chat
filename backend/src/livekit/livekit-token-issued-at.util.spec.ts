import { signIssuedAt, verifyIssuedAt } from './livekit-token-issued-at.util';

describe('livekit-token-issued-at util', () => {
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
});
