import { execFile } from 'child_process';
import { FfmpegProvider } from './ffmpeg.provider';

// The provider runs ffprobe itself so the time limit can kill it; mocking
// execFile keeps these tests independent of the real binary.
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn(),
}));

const execFileMock = execFile as unknown as jest.Mock;

type ExecFileCallback = (
  error: (Error & { killed?: boolean }) | null,
  stdout: string,
  stderr: string,
) => void;

describe('FfmpegProvider', () => {
  let provider: FfmpegProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FFPROBE_PATH;
    provider = new FfmpegProvider();
  });

  afterEach(() => {
    delete process.env.FFPROBE_PATH;
  });

  describe('probeStreams', () => {
    it('passes the path as its own argument under the time limit', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: ExecFileCallback,
        ) => {
          callback(
            null,
            JSON.stringify({
              streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
            }),
            '',
          );
        },
      );

      await expect(
        provider.probeStreams('/uploads/clip.mp4', 5000),
      ).resolves.toEqual({
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      });

      expect(execFileMock).toHaveBeenCalledWith(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_streams',
          '/uploads/clip.mp4',
        ],
        expect.objectContaining({
          timeout: 5000,
          killSignal: 'SIGKILL',
          maxBuffer: expect.any(Number),
        }),
        expect.any(Function),
      );
    });

    it('uses the configured ffprobe binary', async () => {
      process.env.FFPROBE_PATH = '/opt/ffmpeg/bin/ffprobe';
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: ExecFileCallback,
        ) => {
          callback(null, JSON.stringify({ streams: [] }), '');
        },
      );

      await provider.probeStreams('/uploads/clip.mp4', 5000);

      expect(execFileMock.mock.calls[0][0]).toBe('/opt/ffmpeg/bin/ffprobe');
    });

    it('rejects when ffprobe exits non-zero', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: ExecFileCallback,
        ) => {
          callback(
            Object.assign(new Error('Command failed: Invalid data found'), {
              code: 1,
            }),
            '',
            'Invalid data found when processing input',
          );
        },
      );

      await expect(
        provider.probeStreams('/uploads/broken.jpg', 5000),
      ).rejects.toThrow('Invalid data found');
    });

    it('rejects when the time limit kills ffprobe', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: ExecFileCallback,
        ) => {
          callback(
            Object.assign(new Error('Command failed: ffprobe'), {
              killed: true,
            }),
            '',
            '',
          );
        },
      );

      await expect(
        provider.probeStreams('/uploads/slow.mp4', 5000),
      ).rejects.toThrow('ffprobe timed out after 5000 ms');
    });

    it('rejects when the output is not JSON', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: ExecFileCallback,
        ) => {
          callback(null, 'Invalid data found when processing input', '');
        },
      );

      await expect(
        provider.probeStreams('/uploads/broken.jpg', 5000),
      ).rejects.toThrow('unparsable output');
    });
  });
});
