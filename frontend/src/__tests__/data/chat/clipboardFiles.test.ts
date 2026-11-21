import { describe, expect, it } from 'vitest';
import { clipboardFiles } from '../../../data/chat/clipboardFiles';

function item(kind: string, file: File | null) {
  return { kind, getAsFile: () => file };
}

describe('clipboardFiles', () => {
  it('no data or no items: []', () => {
    expect(clipboardFiles(null)).toEqual([]);
    expect(clipboardFiles(undefined)).toEqual([]);
    expect(clipboardFiles({} as DataTransfer)).toEqual([]);
  });

  it('keeps only file items whose getAsFile() is non-null, in order', () => {
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.txt');
    const data = { items: [item('string', a), item('file', a), item('file', null), item('file', b)] } as unknown as DataTransfer;
    expect(clipboardFiles(data)).toEqual([a, b]);
  });

  it('text-only clipboard: []', () => {
    const data = { items: [item('string', null)] } as unknown as DataTransfer;
    expect(clipboardFiles(data)).toEqual([]);
  });
});
