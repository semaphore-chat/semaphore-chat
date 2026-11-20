import { dispositionFor, normaliseMimeType } from './file-disposition';

describe('normaliseMimeType', () => {
  it.each([
    ['image/PNG', 'image/png'],
    ['image/svg+xml; charset=utf-8', 'image/svg+xml'],
    ['  Image/SVG+XML ;x=y', 'image/svg+xml'],
    ['text/ html', 'text/html'],
  ])('%s -> %s', (raw, expected) => {
    expect(normaliseMimeType(raw)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'garbage',
    '/png',
    'image/',
    'a/b/c',
    '<script>/x',
    ';charset=x',
  ])('falls back for %j', (raw) => {
    expect(normaliseMimeType(raw)).toBe('application/octet-stream');
  });

  it('falls back for null, undefined and non-strings', () => {
    expect(normaliseMimeType(null)).toBe('application/octet-stream');
    expect(normaliseMimeType(undefined)).toBe('application/octet-stream');
    expect(normaliseMimeType(5 as unknown as string)).toBe(
      'application/octet-stream',
    );
  });
});

describe('dispositionFor', () => {
  it.each([
    'image/svg+xml',
    'image/SVG+xml',
    'image/svg+xml; charset=utf-8',
    'image/svg',
    'text/html',
    'TEXT/HTML; charset=x',
    'application/xhtml+xml',
    'application/xml',
    'text/xml',
    'text/xsl',
    'application/javascript',
    'text/javascript',
    'application/atom+xml',
    'application/vnd.foo+XML',
    'garbage',
    '',
    'application/octet-stream',
  ])('forces attachment for %j', (type) => {
    expect(dispositionFor(type)).toBe('attachment');
  });

  it('forces attachment for null/undefined', () => {
    expect(dispositionFor(null)).toBe('attachment');
    expect(dispositionFor(undefined)).toBe('attachment');
  });

  it.each([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'video/mp4',
    'audio/mpeg',
    'application/pdf',
    'text/plain',
    'IMAGE/PNG; foo=bar',
  ])('keeps %j inline', (type) => {
    expect(dispositionFor(type)).toBe('inline');
  });
});
