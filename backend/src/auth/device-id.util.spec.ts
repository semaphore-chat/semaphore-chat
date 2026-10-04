import { parseDeviceId } from './device-id.util';

describe('parseDeviceId', () => {
  it('accepts a UUID, lower-cased', () => {
    expect(parseDeviceId('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a UUID', 'my-laptop'],
    ['too long', `3f2504e0-4f89-41d3-9a0c-0305e82c3301${'a'.repeat(1000)}`],
    ['a UUID with extra text', '3f2504e0-4f89-41d3-9a0c-0305e82c3301x'],
    ['a repeated header', ['3f2504e0-4f89-41d3-9a0c-0305e82c3301']],
    ['a number', 42],
  ])('ignores %s', (_label, value) => {
    expect(parseDeviceId(value)).toBeUndefined();
  });
});
