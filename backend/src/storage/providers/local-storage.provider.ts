import { Injectable, Logger } from '@nestjs/common';
import { promises as fs, createReadStream, ReadStream } from 'fs';
import { join } from 'path';
import {
  IStorageProvider,
  FileStats,
  DeleteDirectoryOptions,
  ListFilesOptions,
} from '../interfaces/storage-provider.interface';

/**
 * Local Filesystem Storage Provider
 *
 * Implements storage operations using Node.js filesystem (fs/promises).
 * This provider handles all direct disk operations.
 */
@Injectable()
export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);

  /**
   * Ensures a directory exists, creating it recursively if necessary
   */
  async ensureDirectory(path: string): Promise<void> {
    try {
      await fs.mkdir(path, { recursive: true });
      this.logger.debug(`Directory ensured: ${path}`);
    } catch (error) {
      this.logger.error(`Failed to ensure directory ${path}:`, error);
      throw error;
    }
  }

  /**
   * Checks if a directory exists using fs.access
   */
  async directoryExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes a directory with optional recursive and force flags
   */
  async deleteDirectory(
    path: string,
    options: DeleteDirectoryOptions = {},
  ): Promise<void> {
    const { recursive = false, force = false } = options;

    try {
      await fs.rm(path, { recursive, force });
      this.logger.debug(`Directory deleted: ${path}`);
    } catch (error) {
      this.logger.error(`Failed to delete directory ${path}:`, error);
      throw error;
    }
  }

  /**
   * Deletes a single file using fs.unlink
   */
  async deleteFile(path: string): Promise<void> {
    try {
      await fs.unlink(path);
      this.logger.debug(`File deleted: ${path}`);
    } catch (error) {
      this.logger.error(`Failed to delete file ${path}:`, error);
      throw error;
    }
  }

  /**
   * Checks if a file exists using fs.access
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists files in a directory with optional filter function
   */
  async listFiles(
    dirPath: string,
    options: ListFilesOptions = {},
  ): Promise<string[]> {
    try {
      const files = await fs.readdir(dirPath);

      if (options.filter) {
        return files.filter(options.filter);
      }

      return files;
    } catch (error) {
      this.logger.error(`Failed to list files in ${dirPath}:`, error);
      throw error;
    }
  }

  /**
   * Gets file statistics (size, modification time, creation time)
   */
  async getFileStats(path: string): Promise<FileStats> {
    try {
      const stats = await fs.stat(path);
      return {
        size: stats.size,
        mtime: stats.mtime,
        ctime: stats.ctime,
      };
    } catch (error) {
      this.logger.error(`Failed to get file stats for ${path}:`, error);
      throw error;
    }
  }

  /**
   * Reads file contents and returns as Buffer
   */
  async readFile(path: string): Promise<Buffer> {
    try {
      return await fs.readFile(path);
    } catch (error) {
      this.logger.error(`Failed to read file ${path}:`, error);
      throw error;
    }
  }

  /**
   * Writes data to a file (creates or overwrites)
   */
  async writeFile(path: string, data: Buffer | string): Promise<void> {
    try {
      await fs.writeFile(path, data);
      this.logger.debug(`File written: ${path}`);
    } catch (error) {
      this.logger.error(`Failed to write file ${path}:`, error);
      throw error;
    }
  }

  /**
   * Deletes files older than a specified date in a directory
   * This is a convenience method that combines listFiles, getFileStats, and deleteFile
   *
   * @param dirPath - Directory to scan
   * @param olderThan - Delete files with mtime before this date
   * @returns Number of files deleted
   */
  async deleteOldFiles(dirPath: string, olderThan: Date): Promise<number> {
    let deletedCount = 0;

    try {
      // Check if directory exists first
      const exists = await this.directoryExists(dirPath);
      if (!exists) {
        this.logger.debug(
          `Directory does not exist, skipping cleanup: ${dirPath}`,
        );
        return 0;
      }

      // List all files in directory
      const files = await this.listFiles(dirPath);

      // Check each file's modification time and delete if old
      for (const file of files) {
        const filePath = join(dirPath, file);

        try {
          const stats = await this.getFileStats(filePath);

          if (stats.mtime < olderThan) {
            await this.deleteFile(filePath);
            deletedCount++;
          }
        } catch (error: any) {
          // File was deleted between listing and stat/unlink (race with other crons or user actions) — skip silently
          if (error?.code === 'ENOENT') {
            continue;
          }
          this.logger.warn(`Failed to process file ${filePath}:`, error);
        }
      }

      if (deletedCount > 0) {
        this.logger.log(`Deleted ${deletedCount} old files from ${dirPath}`);
      }

      return deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete old files in ${dirPath}:`, error);
      throw error;
    }
  }

  /**
   * Creates a readable stream for a file
   * This is synchronous as it returns the stream object directly
   */
  createReadStream(path: string): ReadStream {
    this.logger.debug(`Creating read stream for: ${path}`);
    return createReadStream(path);
  }

  /**
   * Gets a URL for accessing the file
   * For local storage, this simply returns the file path
   * For cloud storage, this would return a signed URL
   */
  getFileUrl(path: string): Promise<string> {
    // For local storage, the path is the URL
    return Promise.resolve(path);
  }

  /**
   * Resolves a relative path with a prefix using path.join
   * For local filesystem, this joins the prefix and relative path properly
   */
  resolvePath(relativePath: string, prefix: string): string {
    return join(prefix, relativePath);
  }

  /**
   * Lists files in a directory with prefix resolution
   */
  async listFilesWithPrefix(
    relativeDir: string,
    prefix: string,
    options: ListFilesOptions = {},
  ): Promise<string[]> {
    const fullPath = this.resolvePath(relativeDir, prefix);
    return this.listFiles(fullPath, options);
  }

  /**
   * Reads file contents with prefix resolution
   */
  async readFileWithPrefix(
    relativePath: string,
    prefix: string,
  ): Promise<Buffer> {
    const fullPath = this.resolvePath(relativePath, prefix);
    return this.readFile(fullPath);
  }

  /**
   * Deletes a directory with prefix resolution
   */
  async deleteDirectoryWithPrefix(
    relativeDir: string,
    prefix: string,
    options: DeleteDirectoryOptions = {},
  ): Promise<void> {
    const fullPath = this.resolvePath(relativeDir, prefix);
    return this.deleteDirectory(fullPath, options);
  }

  /**
   * Gets file stats with prefix resolution
   */
  async getFileStatsWithPrefix(
    relativePath: string,
    prefix: string,
  ): Promise<FileStats> {
    const fullPath = this.resolvePath(relativePath, prefix);
    return this.getFileStats(fullPath);
  }

  /**
   * Checks if directory exists with prefix resolution
   */
  async directoryExistsWithPrefix(
    relativeDir: string,
    prefix: string,
  ): Promise<boolean> {
    const fullPath = this.resolvePath(relativeDir, prefix);
    return this.directoryExists(fullPath);
  }
}
