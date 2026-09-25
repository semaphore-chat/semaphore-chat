import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MAGIC_BYTES_HEADER_LENGTH,
  matchesDeclaredImageType,
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

describe('matchesDeclaredImageType', () => {
  describe('valid image headers', () => {
    it('accepts a JPEG header declared as image/jpeg', () => {
      expect(matchesDeclaredImageType(JPEG_HEADER, 'image/jpeg')).toBe(true);
    });

    it('accepts a JPEG header declared as image/jpg (alias)', () => {
      expect(matchesDeclaredImageType(JPEG_HEADER, 'image/jpg')).toBe(true);
    });

    it('accepts a PNG header declared as image/png', () => {
      expect(matchesDeclaredImageType(PNG_HEADER, 'image/png')).toBe(true);
    });

    it('accepts a GIF header declared as image/gif', () => {
      expect(matchesDeclaredImageType(GIF_HEADER, 'image/gif')).toBe(true);
    });

    it('accepts a WebP header declared as image/webp', () => {
      expect(matchesDeclaredImageType(WEBP_HEADER, 'image/webp')).toBe(true);
    });

    it('accepts SVG markup declared as image/svg+xml', () => {
      const svg = Buffer.from('<svg xmlns="ht', 'utf8');
      expect(matchesDeclaredImageType(svg, 'image/svg+xml')).toBe(true);
    });

    it('accepts SVG with XML declaration, BOM and leading whitespace', () => {
      const svg = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('\n  <?xml vers', 'utf8'),
      ]);
      expect(matchesDeclaredImageType(svg, 'image/svg+xml')).toBe(true);
    });
  });

  describe('content/MIME mismatches', () => {
    it('rejects a renamed executable claiming image/png', () => {
      expect(matchesDeclaredImageType(EXE_HEADER, 'image/png')).toBe(false);
    });

    it('rejects a renamed executable claiming image/jpeg', () => {
      expect(matchesDeclaredImageType(EXE_HEADER, 'image/jpeg')).toBe(false);
    });

    it('rejects a renamed executable claiming image/gif', () => {
      expect(matchesDeclaredImageType(EXE_HEADER, 'image/gif')).toBe(false);
    });

    it('rejects a renamed executable claiming image/webp', () => {
      expect(matchesDeclaredImageType(EXE_HEADER, 'image/webp')).toBe(false);
    });

    it('rejects binary content claiming image/svg+xml', () => {
      expect(matchesDeclaredImageType(EXE_HEADER, 'image/svg+xml')).toBe(false);
    });

    it('rejects a PNG header declared as image/jpeg (cross-format swap)', () => {
      expect(matchesDeclaredImageType(PNG_HEADER, 'image/jpeg')).toBe(false);
    });

    it('rejects an empty buffer for any image type', () => {
      expect(matchesDeclaredImageType(Buffer.alloc(0), 'image/png')).toBe(
        false,
      );
    });

    it('rejects a truncated PNG header', () => {
      expect(
        matchesDeclaredImageType(PNG_HEADER.subarray(0, 4), 'image/png'),
      ).toBe(false);
    });
  });

  describe('non-image MIME types pass through', () => {
    it('passes arbitrary content declared as application/pdf', () => {
      expect(matchesDeclaredImageType(EXE_HEADER, 'application/pdf')).toBe(
        true,
      );
    });

    it('passes arbitrary content declared as video/mp4', () => {
      expect(matchesDeclaredImageType(Buffer.alloc(0), 'video/mp4')).toBe(true);
    });

    it('passes arbitrary content declared as application/octet-stream', () => {
      expect(
        matchesDeclaredImageType(EXE_HEADER, 'application/octet-stream'),
      ).toBe(true);
    });
  });

  describe('unknown image subtypes fail closed', () => {
    it('rejects image/tiff even with plausible content', () => {
      const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
      expect(matchesDeclaredImageType(tiff, 'image/tiff')).toBe(false);
    });

    it('rejects image/x-icon', () => {
      const ico = Buffer.from([0x00, 0x00, 0x01, 0x00]);
      expect(matchesDeclaredImageType(ico, 'image/x-icon')).toBe(false);
    });
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
    await writeFile(filePath, Buffer.concat([PNG_HEADER, Buffer.alloc(64)]));

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
