import { clampLimit } from './clamp-limit.util';

describe('clampLimit', () => {
  it('keeps a limit in range', () => {
    expect(clampLimit(20, 100)).toBe(20);
  });

  it('caps at the maximum', () => {
    expect(clampLimit(100000, 100)).toBe(100);
  });

  it('holds zero and negative limits at 1', () => {
    // A negative Prisma `take` reads the list backwards
    expect(clampLimit(0, 100)).toBe(1);
    expect(clampLimit(-5, 100)).toBe(1);
  });
});
