import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MAGIC_BYTES_HEADER_LENGTH,
  matchesDeclaredMediaType,
  readFileHeader,
} from './magic-bytes.util';

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const GIF_HEADER = Buffer.from('GIF89a', 'ascii');
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);
// MZ header of a Windows executable
const EXE_HEADER = Buffer.from([
  0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
]);

describe('matchesDeclaredMediaType', () => {
  describe('valid image headers', () => {
    it('accepts a JPEG header declared as image/jpeg', () => {
      expect(matchesDeclaredMediaType(JPEG_HEADER, 'image/jpeg')).toBe(true);
    });

    it('accepts a JPEG header declared as image/jpg (alias)', () => {
      expect(matchesDeclaredMediaType(JPEG_HEADER, 'image/jpg')).toBe(true);
    });

    it('accepts a PNG header declared as image/png', () => {
      expect(matchesDeclaredMediaType(PNG_HEADER, 'image/png')).toBe(true);
    });

    it('accepts a GIF header declared as image/gif', () => {
      expect(matchesDeclaredMediaType(GIF_HEADER, 'image/gif')).toBe(true);
    });

    it('accepts a WebP header declared as image/webp', () => {
      expect(matchesDeclaredMediaType(WEBP_HEADER, 'image/webp')).toBe(true);
    });

    it('accepts SVG markup declared as image/svg+xml', () => {
      const svg = Buffer.from('<svg xmlns="ht', 'utf8');
      expect(matchesDeclaredMediaType(svg, 'image/svg+xml')).toBe(true);
    });

    it('accepts SVG with XML declaration, BOM and leading whitespace', () => {
      const svg = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('\n  <?xml vers', 'utf8'),
      ]);
      expect(matchesDeclaredMediaType(svg, 'image/svg+xml')).toBe(true);
    });
  });

  describe('content/MIME mismatches', () => {
    it('rejects a renamed executable claiming image/png', () => {
      expect(matchesDeclaredMediaType(EXE_HEADER, 'image/png')).toBe(false);
    });

    it('rejects a renamed executable claiming image/jpeg', () => {
      expect(matchesDeclaredMediaType(EXE_HEADER, 'image/jpeg')).toBe(false);
    });

    it('rejects a renamed executable claiming image/gif', () => {
      expect(matchesDeclaredMediaType(EXE_HEADER, 'image/gif')).toBe(false);
    });

    it('rejects a renamed executable claiming image/webp', () => {
      expect(matchesDeclaredMediaType(EXE_HEADER, 'image/webp')).toBe(false);
    });

    it('rejects binary content claiming image/svg+xml', () => {
      expect(matchesDeclaredMediaType(EXE_HEADER, 'image/svg+xml')).toBe(false);
    });

    it('rejects a PNG header declared as image/jpeg (cross-format swap)', () => {
      expect(matchesDeclaredMediaType(PNG_HEADER, 'image/jpeg')).toBe(false);
    });

    it('rejects an empty buffer for any image type', () => {
      expect(matchesDeclaredMediaType(Buffer.alloc(0), 'image/png')).toBe(
        false,
      );
    });

    it('rejects a truncated PNG header', () => {
      expect(
        matchesDeclaredMediaType(PNG_HEADER.subarray(0, 4), 'image/png'),
      ).toBe(false);
    });
  });

  describe('non-image MIME types pass through', () => {
    it('passes arbitrary content declared as application/pdf', () => {
      expect(matchesDeclaredMediaType(EXE_HEADER, 'application/pdf')).toBe(
        true,
      );
    });

    it('passes arbitrary content declared as application/octet-stream', () => {
      expect(
        matchesDeclaredMediaType(EXE_HEADER, 'application/octet-stream'),
      ).toBe(true);
    });
  });

  describe('unknown image subtypes fail closed', () => {
    it('rejects image/tiff even with plausible content', () => {
      const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
      expect(matchesDeclaredMediaType(tiff, 'image/tiff')).toBe(false);
    });

    it('rejects image/x-icon', () => {
      const ico = Buffer.from([0x00, 0x00, 0x01, 0x00]);
      expect(matchesDeclaredMediaType(ico, 'image/x-icon')).toBe(false);
    });
  });
});

/** An MPEG-1 Layer III frame header: 128 kbps, 44.1 kHz, no padding (417 bytes). */
const MP3_FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
const MP3_FRAME_LENGTH = 417;
const mp3Frames = (count: number, prefix = Buffer.alloc(0)): Buffer => {
  const frame = Buffer.alloc(MP3_FRAME_LENGTH);
  MP3_FRAME_HEADER.copy(frame);
  return Buffer.concat([prefix, ...Array.from({ length: count }, () => frame)]);
};
const riff = (form: string): Buffer =>
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from(form, 'ascii'),
  ]);
const isoBox = (type: string): Buffer =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(type, 'ascii')]);
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
const OGG = Buffer.from('OggS\x00\x02', 'latin1');
const ADTS = Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc]);

describe('matchesDeclaredMediaType (audio and video)', () => {
  const valid: Array<[string, Buffer]> = [
    ['video/mp4', isoBox('ftyp')],
    ['video/mp4', isoBox('moov')],
    ['video/quicktime', isoBox('ftyp')],
    ['video/quicktime', isoBox('wide')],
    ['video/quicktime', isoBox('mdat')],
    ['video/webm', EBML],
    ['video/ogg', OGG],
    ['video/x-msvideo', riff('AVI ')],
    ['audio/webm', EBML],
    ['audio/ogg', OGG],
    ['audio/wav', riff('WAVE')],
    ['audio/x-wav', riff('WAVE')],
    [
      'audio/wav',
      Buffer.concat([
        Buffer.from('RF64'),
        Buffer.alloc(4),
        Buffer.from('WAVE'),
      ]),
    ],
    ['audio/aac', ADTS],
    ['audio/aac', Buffer.from('ID3\x04\x00', 'latin1')],
    ['audio/aac', isoBox('ftyp')],
    ['audio/mpeg', Buffer.from('ID3\x04\x00\x00', 'latin1')],
    ['audio/mpeg', mp3Frames(3)],
  ];

  it.each(valid)('accepts a real %s header', (mimetype, bytes) => {
    expect(matchesDeclaredMediaType(bytes, mimetype)).toBe(true);
  });

  const allowedMedia = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-msvideo',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
  ];

  it.each(allowedMedia)(
    'rejects a Windows executable declared as %s',
    (mimetype) => {
      const dll = Buffer.concat([EXE_HEADER, Buffer.alloc(4088, 0xff)]);
      expect(matchesDeclaredMediaType(dll, mimetype)).toBe(false);
    },
  );

  it.each(allowedMedia)('rejects an empty file declared as %s', (mimetype) => {
    expect(matchesDeclaredMediaType(Buffer.alloc(0), mimetype)).toBe(false);
  });

  it('rejects a cross-format swap (WAV declared as video/x-msvideo)', () => {
    expect(matchesDeclaredMediaType(riff('WAVE'), 'video/x-msvideo')).toBe(
      false,
    );
  });

  it('rejects unknown audio/video subtypes (fail closed)', () => {
    expect(matchesDeclaredMediaType(isoBox('ftyp'), 'video/x-matroska')).toBe(
      false,
    );
    expect(matchesDeclaredMediaType(OGG, 'audio/flac')).toBe(false);
  });

  describe('audio/mpeg frame sync', () => {
    it('accepts frames after leading zero padding', () => {
      expect(
        matchesDeclaredMediaType(
          mp3Frames(3, Buffer.alloc(1000)),
          'audio/mpeg',
        ),
      ).toBe(true);
    });

    it('accepts a single frame that ends the buffer', () => {
      expect(
        matchesDeclaredMediaType(
          Buffer.concat([Buffer.alloc(10), MP3_FRAME_HEADER, Buffer.alloc(20)]),
          'audio/mpeg',
        ),
      ).toBe(true);
    });

    it('rejects frames that start after the first 4 KB', () => {
      expect(
        matchesDeclaredMediaType(
          mp3Frames(3, Buffer.alloc(4096)),
          'audio/mpeg',
        ),
      ).toBe(false);
    });

    it('rejects a lone sync-looking pair whose next frame is missing', () => {
      const bytes = Buffer.alloc(2000, 0x41);
      MP3_FRAME_HEADER.copy(bytes, 100);
      expect(matchesDeclaredMediaType(bytes, 'audio/mpeg')).toBe(false);
    });

    it('rejects headers with a reserved version, layer, bitrate or rate', () => {
      for (const header of [
        [0xff, 0xeb, 0x90, 0x00], // version 01 (reserved)
        [0xff, 0xf9, 0x90, 0x00], // layer 00 (reserved)
        [0xff, 0xfb, 0xf0, 0x00], // bitrate index 15
        [0xff, 0xfb, 0x9c, 0x00], // sample rate index 3
      ]) {
        expect(
          matchesDeclaredMediaType(Buffer.from(header), 'audio/mpeg'),
        ).toBe(false);
      }
    });
  });

  it('reads enough of the file for a 4 KB frame-sync search', () => {
    expect(MAGIC_BYTES_HEADER_LENGTH).toBeGreaterThanOrEqual(4096 + 4);
  });
});

describe('readFileHeader', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'magic-bytes-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const makeFile = (
    overrides: Partial<Express.Multer.File>,
  ): Express.Multer.File => ({
    fieldname: 'file',
    originalname: 'test.bin',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: 0,
    buffer: undefined as unknown as Buffer,
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  });

  it('reads the leading bytes from file.path (disk storage)', async () => {
    const filePath = join(tempDir, 'disk.png');
    await writeFile(
      filePath,
      Buffer.concat([PNG_HEADER, Buffer.alloc(MAGIC_BYTES_HEADER_LENGTH)]),
    );

    const header = await readFileHeader(makeFile({ path: filePath }));

    expect(header.length).toBe(MAGIC_BYTES_HEADER_LENGTH);
    expect(header.subarray(0, 8)).toEqual(PNG_HEADER);
  });

  it('returns fewer bytes when the file is shorter than the header length', async () => {
    const filePath = join(tempDir, 'short.gif');
    await writeFile(filePath, GIF_HEADER);

    const header = await readFileHeader(makeFile({ path: filePath }));

    expect(header).toEqual(GIF_HEADER);
  });

  it('prefers file.buffer when present (memory storage)', async () => {
    const header = await readFileHeader(makeFile({ buffer: JPEG_HEADER }));

    expect(header).toEqual(JPEG_HEADER);
  });

  it('returns an empty buffer when neither buffer nor path is available', async () => {
    const header = await readFileHeader(makeFile({}));

    expect(header.length).toBe(0);
  });

  it('returns an empty buffer (fail closed) when the path cannot be read', async () => {
    const header = await readFileHeader(
      makeFile({ path: join(tempDir, 'does-not-exist.png') }),
    );

    expect(header.length).toBe(0);
  });
});
