import { TestBed } from '@suites/unit';
import { LocalStorageProvider } from './local-storage.provider';
import { promises as fs, createReadStream } from 'fs';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    access: jest.fn(),
    rm: jest.fn(),
    unlink: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
  createReadStream: jest.fn(),
}));

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    const { unit } = await TestBed.solitary(LocalStorageProvider).compile();

    provider = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('ensureDirectory', () => {
    it('should create directory recursively', async () => {
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);

      await provider.ensureDirectory('/test/nested/path');

      expect(fs.mkdir).toHaveBeenCalledWith('/test/nested/path', {
        recursive: true,
      });
    });

    it('should propagate error when mkdir fails', async () => {
      const error = new Error('Permission denied');
      (fs.mkdir as jest.Mock).mockRejectedValue(error);

      await expect(provider.ensureDirectory('/test/path')).rejects.toThrow(
        'Permission denied',
      );
    });
  });

  describe('directoryExists', () => {
    it('should return true when directory exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const result = await provider.directoryExists('/existing/path');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith('/existing/path');
    });

    it('should return false when directory does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await provider.directoryExists('/missing/path');

      expect(result).toBe(false);
    });
  });

  describe('deleteDirectory', () => {
    it('should delete directory with default options', async () => {
      (fs.rm as jest.Mock).mockResolvedValue(undefined);

      await provider.deleteDirectory('/test/path');

      expect(fs.rm).toHaveBeenCalledWith('/test/path', {
        recursive: false,
        force: false,
      });
    });

    it('should delete directory with recursive option', async () => {
      (fs.rm as jest.Mock).mockResolvedValue(undefined);

      await provider.deleteDirectory('/test/path', { recursive: true });

      expect(fs.rm).toHaveBeenCalledWith('/test/path', {
        recursive: true,
        force: false,
      });
    });

    it('should delete directory with force option', async () => {
      (fs.rm as jest.Mock).mockResolvedValue(undefined);

      await provider.deleteDirectory('/test/path', { force: true });

      expect(fs.rm).toHaveBeenCalledWith('/test/path', {
        recursive: false,
        force: true,
      });
    });

    it('should delete directory with both options', async () => {
      (fs.rm as jest.Mock).mockResolvedValue(undefined);

      await provider.deleteDirectory('/test/path', {
        recursive: true,
        force: true,
      });

      expect(fs.rm).toHaveBeenCalledWith('/test/path', {
        recursive: true,
        force: true,
      });
    });

    it('should propagate error when rm fails', async () => {
      const error = new Error('Directory not empty');
      (fs.rm as jest.Mock).mockRejectedValue(error);

      await expect(provider.deleteDirectory('/test/path')).rejects.toThrow(
        'Directory not empty',
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file using unlink', async () => {
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      await provider.deleteFile('/test/file.txt');

      expect(fs.unlink).toHaveBeenCalledWith('/test/file.txt');
    });

    it('should propagate error when unlink fails', async () => {
      const error = new Error('File not found');
      (fs.unlink as jest.Mock).mockRejectedValue(error);

      await expect(provider.deleteFile('/test/missing.txt')).rejects.toThrow(
        'File not found',
      );
    });
  });

  describe('fileExists', () => {
    it('should return true when file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const result = await provider.fileExists('/test/file.txt');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith('/test/file.txt');
    });

    it('should return false when file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await provider.fileExists('/test/missing.txt');

      expect(result).toBe(false);
    });
  });

  describe('listFiles', () => {
    it('should list all files in directory', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([
        'file1.txt',
        'file2.txt',
        'file3.txt',
      ]);

      const result = await provider.listFiles('/test/dir');

      expect(result).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
      expect(fs.readdir).toHaveBeenCalledWith('/test/dir');
    });

    it('should apply filter function when provided', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([
        'file1.txt',
        'file2.ts',
        'file3.txt',
        'file4.ts',
      ]);

      const result = await provider.listFiles('/test/dir', {
        filter: (f) => f.endsWith('.ts'),
      });

      expect(result).toEqual(['file2.ts', 'file4.ts']);
    });

    it('should return empty array for empty directory', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await provider.listFiles('/test/empty');

      expect(result).toEqual([]);
    });

    it('should propagate error when readdir fails', async () => {
      const error = new Error('Directory not accessible');
      (fs.readdir as jest.Mock).mockRejectedValue(error);

      await expect(provider.listFiles('/test/inaccessible')).rejects.toThrow(
        'Directory not accessible',
      );
    });
  });

  describe('getFileStats', () => {
    it('should return file statistics', async () => {
      const mockStats = {
        size: 1024,
        mtime: new Date('2025-01-01'),
        ctime: new Date('2025-01-02'),
      };
      (fs.stat as jest.Mock).mockResolvedValue(mockStats);

      const result = await provider.getFileStats('/test/file.txt');

      expect(result).toEqual({
        size: 1024,
        mtime: new Date('2025-01-01'),
        ctime: new Date('2025-01-02'),
      });
      expect(fs.stat).toHaveBeenCalledWith('/test/file.txt');
    });

    it('should propagate error when stat fails', async () => {
      const error = new Error('File not found');
      (fs.stat as jest.Mock).mockRejectedValue(error);

      await expect(provider.getFileStats('/test/missing.txt')).rejects.toThrow(
        'File not found',
      );
    });
  });

  describe('readFile', () => {
    it('should read file contents as Buffer', async () => {
      const buffer = Buffer.from('test content');
      (fs.readFile as jest.Mock).mockResolvedValue(buffer);

      const result = await provider.readFile('/test/file.txt');

      expect(result).toBe(buffer);
      expect(fs.readFile).toHaveBeenCalledWith('/test/file.txt');
    });

    it('should propagate error when read fails', async () => {
      const error = new Error('File not readable');
      (fs.readFile as jest.Mock).mockRejectedValue(error);

      await expect(provider.readFile('/test/unreadable.txt')).rejects.toThrow(
        'File not readable',
      );
    });
  });

  describe('writeFile', () => {
    it('should write string content to file', async () => {
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await provider.writeFile('/test/file.txt', 'text content');

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/file.txt',
        'text content',
      );
    });

    it('should write Buffer content to file', async () => {
      const buffer = Buffer.from('binary content');
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await provider.writeFile('/test/file.bin', buffer);

      expect(fs.writeFile).toHaveBeenCalledWith('/test/file.bin', buffer);
    });

    it('should propagate error when write fails', async () => {
      const error = new Error('Disk full');
      (fs.writeFile as jest.Mock).mockRejectedValue(error);

      await expect(
        provider.writeFile('/test/file.txt', 'content'),
      ).rejects.toThrow('Disk full');
    });
  });

  describe('deleteOldFiles', () => {
    const cutoffDate = new Date('2025-01-10');

    it('should delete files older than cutoff date', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined); // directoryExists
      (fs.readdir as jest.Mock).mockResolvedValue(['old.txt', 'new.txt']);
      (fs.stat as jest.Mock)
        .mockResolvedValueOnce({ mtime: new Date('2025-01-05') }) // old
        .mockResolvedValueOnce({ mtime: new Date('2025-01-15') }); // new
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await provider.deleteOldFiles('/test/dir', cutoffDate);

      expect(result).toBe(1);
      expect(fs.unlink).toHaveBeenCalledTimes(1);
      expect(fs.unlink).toHaveBeenCalledWith('/test/dir/old.txt');
    });

    it('should return 0 when directory does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await provider.deleteOldFiles('/missing/dir', cutoffDate);

      expect(result).toBe(0);
      expect(fs.readdir).not.toHaveBeenCalled();
    });

    it('should return 0 when no files are old enough', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(['file1.txt', 'file2.txt']);
      (fs.stat as jest.Mock)
        .mockResolvedValueOnce({ mtime: new Date('2025-01-15') })
        .mockResolvedValueOnce({ mtime: new Date('2025-01-20') });

      const result = await provider.deleteOldFiles('/test/dir', cutoffDate);

      expect(result).toBe(0);
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should handle empty directory', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      const result = await provider.deleteOldFiles('/test/empty', cutoffDate);

      expect(result).toBe(0);
    });

    it('should continue processing after individual file error', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([
        'error.txt',
        'old.txt',
        'new.txt',
      ]);
      (fs.stat as jest.Mock)
        .mockRejectedValueOnce(new Error('Cannot stat file')) // error.txt
        .mockResolvedValueOnce({ mtime: new Date('2025-01-05') }) // old.txt
        .mockResolvedValueOnce({ mtime: new Date('2025-01-15') }); // new.txt
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await provider.deleteOldFiles('/test/dir', cutoffDate);

      // Should still delete old.txt despite error with error.txt
      expect(result).toBe(1);
      expect(fs.unlink).toHaveBeenCalledWith('/test/dir/old.txt');
    });

    it('should silently skip files deleted between listing and stat (ENOENT race)', async () => {
      const enoentError = Object.assign(new Error('ENOENT'), {
        code: 'ENOENT',
      });
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([
        'deleted.txt',
        'old.txt',
        'also-deleted.txt',
      ]);
      (fs.stat as jest.Mock)
        .mockRejectedValueOnce(enoentError) // deleted.txt - gone
        .mockResolvedValueOnce({ mtime: new Date('2025-01-05') }) // old.txt
        .mockRejectedValueOnce(enoentError); // also-deleted.txt - gone
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await provider.deleteOldFiles('/test/dir', cutoffDate);

      expect(result).toBe(1);
      expect(fs.unlink).toHaveBeenCalledTimes(1);
      expect(fs.unlink).toHaveBeenCalledWith('/test/dir/old.txt');
    });

    it('should propagate error when listFiles fails', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockRejectedValue(
        new Error('Permission denied'),
      );

      await expect(
        provider.deleteOldFiles('/test/dir', cutoffDate),
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('createReadStream', () => {
    it('should create read stream for file', () => {
      const mockStream = {} as any;
      (createReadStream as jest.Mock).mockReturnValue(mockStream);

      const result = provider.createReadStream('/test/file.txt');

      expect(result).toBe(mockStream);
      expect(createReadStream).toHaveBeenCalledWith('/test/file.txt');
    });
  });

  describe('getFileUrl', () => {
    it('should return the path as-is for local storage', async () => {
      const result = await provider.getFileUrl('/test/file.txt');

      expect(result).toBe('/test/file.txt');
    });

    it('should handle various path formats', async () => {
      expect(await provider.getFileUrl('./relative/path')).toBe(
        './relative/path',
      );
      expect(await provider.getFileUrl('/absolute/path')).toBe(
        '/absolute/path',
      );
      expect(await provider.getFileUrl('../parent/path')).toBe(
        '../parent/path',
      );
    });
  });
});
