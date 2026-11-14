import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { crc32 } from 'zlib';
import {
  IMAGE_HEADER_MAX_BYTES,
  MEDIA_MAX_PIXELS,
} from '@/common/constants/media-limits.constant';
import {
  exceedsMediaPixelCap,
  readImageSize,
  readImageSizeFromFile,
} from './image-header.util';

// ---- fixture builders -------------------------------------------------------

const u16le = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u16be = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u24le = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, n >> 16]);
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([
    u32be(data.length),
    typeAndData,
    u32be(crc32(typeAndData)),
  ]);
}

/** A PNG signature and IHDR with a valid CRC (16-bit RGBA by default). */
function png(width: number, height: number, firstChunk = 'IHDR'): Buffer {
  const ihdr = Buffer.concat([
    u32be(width),
    u32be(height),
    Buffer.from([16, 6, 0, 0, 0]),
  ]);
  return Buffer.concat([PNG_SIGNATURE, pngChunk(firstChunk, ihdr)]);
}

interface GifFrame {
  left?: number;
  top?: number;
  width: number;
  height: number;
  localColors?: boolean;
}

/** A GIF89a with the given logical screen and image descriptors. */
function gif(
  screenWidth: number,
  screenHeight: number,
  frames: GifFrame[] = [],
  { globalColors = false, extension = false } = {},
): Buffer {
  const parts: Buffer[] = [
    Buffer.from('GIF89a', 'latin1'),
    u16le(screenWidth),
    u16le(screenHeight),
    Buffer.from([globalColors ? 0x81 : 0x00, 0, 0]), // 2^(1+1) = 4 colours
  ];
  if (globalColors) parts.push(Buffer.alloc(4 * 3, 0x10));
  if (extension) {
    // Graphic control extension, then a NETSCAPE application extension
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00]));
    parts.push(
      Buffer.from([0x21, 0xff, 0x0b]),
      Buffer.from('NETSCAPE2.0', 'latin1'),
      Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
    );
  }
  for (const frame of frames) {
    parts.push(
      Buffer.from([0x2c]),
      u16le(frame.left ?? 0),
      u16le(frame.top ?? 0),
      u16le(frame.width),
      u16le(frame.height),
      Buffer.from([frame.localColors ? 0x80 : 0x00]),
    );
    if (frame.localColors) parts.push(Buffer.alloc(2 * 3, 0x20));
    // LZW minimum code size, one data sub-block, terminator
    parts.push(Buffer.from([0x02, 0x03, 0x01, 0x02, 0x03, 0x00]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

const riffWebp = (chunk: string, payload: Buffer) =>
  Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x24, 0, 0, 0]),
    Buffer.from('WEBP', 'latin1'),
    Buffer.from(chunk, 'latin1'),
    Buffer.from([payload.length, 0, 0, 0]),
    payload,
  ]);

function webpLossy(width: number, height: number): Buffer {
  return riffWebp(
    'VP8 ',
    Buffer.concat([
      Buffer.from([0x30, 0x01, 0x00]), // frame tag
      Buffer.from([0x9d, 0x01, 0x2a]), // start code
      u16le(width),
      u16le(height),
      Buffer.alloc(4),
    ]),
  );
}

function webpLossless(width: number, height: number): Buffer {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const packed = Buffer.alloc(4);
  packed.writeUInt32LE(bits >>> 0);
  return riffWebp(
    'VP8L',
    Buffer.concat([Buffer.from([0x2f]), packed, Buffer.alloc(4)]),
  );
}

/** An extended (VP8X) WebP; `animated` sets the animation flag. */
function webpExtended(width: number, height: number, animated = true): Buffer {
  return riffWebp(
    'VP8X',
    Buffer.concat([
      Buffer.from([animated ? 0x12 : 0x00, 0, 0, 0]),
      u24le(width - 1),
      u24le(height - 1),
    ]),
  );
}

const jpegSegment = (marker: number, payload: Buffer) =>
  Buffer.concat([
    Buffer.from([0xff, marker]),
    u16be(payload.length + 2),
    payload,
  ]);

/** A JPEG frame header segment (SOF0 baseline by default). */
const sof = (width: number, height: number, marker = 0xc0) =>
  jpegSegment(
    marker,
    Buffer.concat([
      Buffer.from([8]),
      u16be(height),
      u16be(width),
      Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ]),
  );

const SOI = Buffer.from([0xff, 0xd8]);
const SOS = Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]);

function jpeg(
  width: number,
  height: number,
  { before = [] as Buffer[], marker = 0xc0 } = {},
): Buffer {
  return Buffer.concat([
    SOI,
    ...before,
    sof(width, height, marker),
    SOS,
    Buffer.from([0x12, 0x34, 0xff, 0xd9]),
  ]);
}

const app = (n: number, size: number, fill = 0x41) =>
  jpegSegment(0xe0 + n, Buffer.alloc(size, fill));

// ---- tests ------------------------------------------------------------------

/** Every prefix of `bytes` reads without throwing; returns each result. */
function everyPrefix(bytes: Buffer) {
  const results: ReturnType<typeof readImageSize>[] = [];
  for (let length = 0; length <= bytes.length; length++) {
    expect(() => readImageSize(bytes.subarray(0, length))).not.toThrow();
    results.push(readImageSize(bytes.subarray(0, length)));
  }
  return results;
}

describe('readImageSize', () => {
  describe('PNG', () => {
    it('reads width and height from IHDR', () => {
      expect(readImageSize(png(1920, 1080))).toEqual({
        width: 1920,
        height: 1080,
      });
    });

    it('reads a decompression-bomb size without decoding anything', () => {
      expect(readImageSize(png(20000, 20000))).toEqual({
        width: 20000,
        height: 20000,
      });
    });

    it('reads the largest 32-bit dimensions', () => {
      expect(readImageSize(png(0xffffffff, 0xffffffff))).toEqual({
        width: 0xffffffff,
        height: 0xffffffff,
      });
    });

    it('treats a zero dimension as unknown', () => {
      expect(readImageSize(png(0, 100))).toBeNull();
      expect(readImageSize(png(100, 0))).toBeNull();
    });

    it('treats a first chunk other than IHDR as unknown', () => {
      expect(readImageSize(png(100, 100, 'IDAT'))).toBeNull();
    });

    it('is unknown at every truncation before the height ends', () => {
      const results = everyPrefix(png(4000, 3000));
      results.slice(0, 24).forEach((r) => expect(r).toBeNull());
      results
        .slice(24)
        .forEach((r) => expect(r).toEqual({ width: 4000, height: 3000 }));
    });
  });

  describe('GIF', () => {
    it('reads the logical screen size', () => {
      expect(
        readImageSize(gif(320, 240, [{ width: 320, height: 240 }])),
      ).toEqual({ width: 320, height: 240 });
    });

    it('uses a frame larger than the logical screen', () => {
      expect(
        readImageSize(gif(1, 1, [{ width: 16000, height: 16000 }])),
      ).toEqual({ width: 16000, height: 16000 });
    });

    it('counts a frame offset into the canvas it needs', () => {
      expect(
        readImageSize(
          gif(100, 100, [
            { width: 100, height: 100 },
            { left: 9000, top: 50, width: 10, height: 8000 },
          ]),
        ),
      ).toEqual({ width: 9010, height: 8050 });
    });

    it('skips global and local colour tables and extension blocks', () => {
      expect(
        readImageSize(
          gif(
            10,
            10,
            [
              { width: 10, height: 10, localColors: true },
              { width: 12000, height: 6000, localColors: true },
            ],
            { globalColors: true, extension: true },
          ),
        ),
      ).toEqual({ width: 12000, height: 6000 });
    });

    it('treats an empty screen with no frames as unknown', () => {
      expect(readImageSize(gif(0, 0))).toBeNull();
    });

    it('never throws on a truncation and never reports less than the screen', () => {
      const bytes = gif(
        200,
        100,
        [{ width: 300, height: 50, localColors: true }],
        { globalColors: true, extension: true },
      );
      const results = everyPrefix(bytes);
      results.slice(0, 10).forEach((r) => expect(r).toBeNull());
      results.slice(10).forEach((r) => {
        expect(r).not.toBeNull();
        expect(r!.width).toBeGreaterThanOrEqual(200);
        expect(r!.height).toBe(100);
      });
      expect(results[results.length - 1]).toEqual({ width: 300, height: 100 });
    });

    it('stops at garbage after the header instead of looping', () => {
      const bytes = Buffer.concat([gif(50, 40), Buffer.alloc(1000, 0x99)]);
      expect(readImageSize(bytes)).toEqual({ width: 50, height: 40 });
    });
  });

  describe('WebP', () => {
    it('reads a lossy (VP8) frame size', () => {
      expect(readImageSize(webpLossy(1024, 768))).toEqual({
        width: 1024,
        height: 768,
      });
    });

    it('ignores the VP8 scaling bits', () => {
      const bytes = webpLossy(1024, 768);
      bytes[27] |= 0xc0; // horizontal scale in the top two bits
      expect(readImageSize(bytes)).toEqual({ width: 1024, height: 768 });
    });

    it('reads a lossless (VP8L) size', () => {
      expect(readImageSize(webpLossless(16000, 16000))).toEqual({
        width: 16000,
        height: 16000,
      });
      expect(readImageSize(webpLossless(1, 1))).toEqual({
        width: 1,
        height: 1,
      });
    });

    it('reads the canvas of an animated (VP8X) WebP', () => {
      expect(readImageSize(webpExtended(16000, 16000))).toEqual({
        width: 16000,
        height: 16000,
      });
      expect(readImageSize(webpExtended(1 << 24, 1 << 24, false))).toEqual({
        width: 1 << 24,
        height: 1 << 24,
      });
    });

    it('treats a bad VP8 start code or VP8L signature as unknown', () => {
      const lossy = webpLossy(10, 10);
      lossy[23] = 0x00;
      expect(readImageSize(lossy)).toBeNull();
      const lossless = webpLossless(10, 10);
      lossless[20] = 0x00;
      expect(readImageSize(lossless)).toBeNull();
    });

    it('treats an unknown first chunk as unknown', () => {
      expect(readImageSize(riffWebp('ALPH', Buffer.alloc(16)))).toBeNull();
    });

    it.each([
      ['VP8', webpLossy(640, 480), 30],
      ['VP8L', webpLossless(640, 480), 25],
      ['VP8X', webpExtended(640, 480), 30],
    ])(
      'is unknown at every truncation of a %s header',
      (_name, bytes, needed) => {
        const results = everyPrefix(bytes);
        results.slice(0, needed).forEach((r) => expect(r).toBeNull());
        results
          .slice(needed)
          .forEach((r) => expect(r).toEqual({ width: 640, height: 480 }));
      },
    );
  });

  describe('JPEG', () => {
    it('reads a baseline frame header', () => {
      expect(readImageSize(jpeg(4032, 3024))).toEqual({
        width: 4032,
        height: 3024,
      });
    });

    it.each([
      0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ])(
      'reads frame header marker 0x%s (progressive, lossless, arithmetic)',
      (marker) => {
        expect(readImageSize(jpeg(16000, 16000, { marker }))).toEqual({
          width: 16000,
          height: 16000,
        });
      },
    );

    it('does not treat DHT (0xC4), JPG (0xC8) or DAC (0xCC) as frame headers', () => {
      for (const marker of [0xc4, 0xc8, 0xcc]) {
        const bytes = Buffer.concat([
          SOI,
          jpegSegment(
            marker,
            Buffer.concat([Buffer.from([8]), u16be(9), u16be(9)]),
          ),
          sof(30, 20),
        ]);
        expect(readImageSize(bytes)).toEqual({ width: 30, height: 20 });
      }
    });

    it('finds the frame header after long EXIF, ICC and XMP segments', () => {
      const bytes = jpeg(8000, 6000, {
        before: [
          app(0, 14),
          app(1, 65533), // EXIF at the segment maximum
          app(2, 65533), // ICC profile, split over APP2 segments
          app(2, 65533),
          app(1, 30000), // XMP
          jpegSegment(0xfe, Buffer.from('comment')),
          jpegSegment(0xdb, Buffer.alloc(65)), // DQT
        ],
      });
      expect(bytes.length).toBeGreaterThan(220_000);
      expect(readImageSize(bytes)).toEqual({ width: 8000, height: 6000 });
    });

    it('ignores the frame header of an embedded EXIF thumbnail', () => {
      const exif = jpegSegment(
        0xe1,
        Buffer.concat([Buffer.from('Exif\0\0'), jpeg(160, 120)]),
      );
      expect(readImageSize(jpeg(4000, 3000, { before: [exif] }))).toEqual({
        width: 4000,
        height: 3000,
      });
    });

    it('skips 0xFF fill bytes and standalone markers', () => {
      const bytes = Buffer.concat([
        SOI,
        Buffer.from([0xff, 0xff, 0xff]),
        app(0, 14),
        Buffer.from([0xff, 0x01, 0xff, 0xd0]),
        sof(640, 480),
      ]);
      expect(readImageSize(bytes)).toEqual({ width: 640, height: 480 });
    });

    it('is unknown when scan data or the end comes before a frame header', () => {
      expect(readImageSize(Buffer.concat([SOI, app(0, 14), SOS]))).toBeNull();
      expect(
        readImageSize(Buffer.concat([SOI, Buffer.from([0xff, 0xd9])])),
      ).toBeNull();
    });

    it('treats a frame height of 0 (set later by DNL) as unknown', () => {
      expect(readImageSize(jpeg(640, 0))).toBeNull();
    });

    it('treats a segment length below 2 or a missing marker as unknown', () => {
      expect(
        readImageSize(
          Buffer.concat([
            SOI,
            Buffer.from([0xff, 0xe0, 0x00, 0x01]),
            sof(9, 9),
          ]),
        ),
      ).toBeNull();
      expect(
        readImageSize(Buffer.concat([SOI, Buffer.from([0x00]), sof(9, 9)])),
      ).toBeNull();
    });

    it('is unknown at every truncation before the width ends', () => {
      const bytes = jpeg(1200, 900, { before: [app(0, 14), app(1, 40)] });
      const sofEnd = 2 + (14 + 4) + (40 + 4) + 9;
      const results = everyPrefix(bytes);
      results.slice(0, sofEnd).forEach((r) => expect(r).toBeNull());
      results
        .slice(sofEnd)
        .forEach((r) => expect(r).toEqual({ width: 1200, height: 900 }));
    });
  });

  describe('other content', () => {
    it.each([
      ['empty', Buffer.alloc(0)],
      ['an executable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1')],
      ['SVG', Buffer.from('<svg width="99999" height="99999"/>')],
      [
        'a RIFF that is not WebP',
        Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'),
      ],
    ])('is unknown for %s', (_name, bytes) => {
      expect(readImageSize(bytes)).toBeNull();
    });

    it('never throws on random bytes behind a valid signature', () => {
      const prefixes = [
        PNG_SIGNATURE,
        Buffer.from('GIF89a', 'latin1'),
        Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8X', 'latin1'),
        Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8L', 'latin1'),
        Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'),
        SOI,
      ];
      let seed = 12345;
      const random = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed & 0xff;
      };
      for (let run = 0; run < 3000; run++) {
        const tail = Buffer.from(Array.from({ length: run % 300 }, random));
        const bytes = Buffer.concat([prefixes[run % prefixes.length], tail]);
        expect(() => readImageSize(bytes)).not.toThrow();
      }
    });
  });
});

describe('exceedsMediaPixelCap', () => {
  it('allows sizes up to the cap and refuses one pixel more', () => {
    expect(exceedsMediaPixelCap({ width: MEDIA_MAX_PIXELS, height: 1 })).toBe(
      false,
    );
    expect(
      exceedsMediaPixelCap({ width: MEDIA_MAX_PIXELS + 1, height: 1 }),
    ).toBe(true);
    expect(exceedsMediaPixelCap({ width: 7071, height: 7071 })).toBe(false);
    expect(exceedsMediaPixelCap({ width: 16000, height: 16000 })).toBe(true);
  });

  it('treats an unknown size as within the cap (the -max_pixels backstop applies)', () => {
    expect(exceedsMediaPixelCap(null)).toBe(false);
  });
});

describe('readImageSizeFromFile', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'image-header-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the size of an image on disk', async () => {
    const file = join(dir, 'bomb.png');
    await writeFile(
      file,
      Buffer.concat([png(20000, 20000), Buffer.alloc(4096)]),
    );
    await expect(readImageSizeFromFile(file)).resolves.toEqual({
      width: 20000,
      height: 20000,
    });
  });

  it('finds a JPEG frame header just inside the read bound', async () => {
    const segments: Buffer[] = [];
    let size = 2;
    while (size + 65537 + 19 < IMAGE_HEADER_MAX_BYTES) {
      segments.push(app(1, 65533));
      size += 65537;
    }
    const file = join(dir, 'inside.jpg');
    await writeFile(file, jpeg(5000, 4000, { before: segments }));
    await expect(readImageSizeFromFile(file)).resolves.toEqual({
      width: 5000,
      height: 4000,
    });
  });

  it('reads no further than the bound: a later frame header is unknown', async () => {
    const segments = Array.from(
      { length: Math.ceil(IMAGE_HEADER_MAX_BYTES / 65537) + 1 },
      () => app(1, 65533),
    );
    const file = join(dir, 'beyond.jpg');
    await writeFile(file, jpeg(16000, 16000, { before: segments }));
    await expect(readImageSizeFromFile(file)).resolves.toBeNull();
  });

  it('is unknown for a missing file', async () => {
    await expect(
      readImageSizeFromFile(join(dir, 'missing.png')),
    ).resolves.toBeNull();
  });
});
