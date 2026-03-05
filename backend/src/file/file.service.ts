import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StorageService } from '@/storage/storage.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly storageService: StorageService,
  ) {}

  findOne(id: string) {
    return this.databaseService.file.findUniqueOrThrow({
      where: { id, deletedAt: null },
    });
  }

  async markForDeletion(fileId: string, tx?: Prisma.TransactionClient) {
    try {
      const client = tx ?? this.databaseService;
      await client.file.update({
        where: { id: fileId },
        data: { deletedAt: new Date() },
      });
      this.logger.debug(`Marked file ${fileId} for deletion`);
    } catch (error) {
      this.logger.warn(`Failed to mark file ${fileId} for deletion:`, error);
      // Don't throw - we don't want to fail message updates if file is already deleted
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupOldFiles() {
    this.logger.debug('Running cleanup of old files...');
    const deletedFiles = await this.databaseService.file.findMany({
      where: {
        deletedAt: { not: null },
      },
    });

    this.logger.debug(`Found ${deletedFiles.length} files to delete.`);

    for (const file of deletedFiles) {
      try {
        if (file.storageType === 'LOCAL' && file.storagePath) {
          // Delete file from local storage
          await this.cleanupFile(file.storagePath);

          // Quota was already decremented at soft-delete time (in FileUploadService.remove)
          await this.databaseService.file.delete({
            where: { id: file.id },
          });
        }
      } catch (error) {
        // Log error but continue with next file
        this.logger.error(`Failed to delete file with ID ${file.id}:`, error);
      }
    }
  }

  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await this.storageService.deleteFile(filePath);
      this.logger.debug(`Cleaned up file: ${filePath}`);
    } catch (error) {
      this.logger.warn(`Failed to clean up file ${filePath}: ${error}`);
      throw error;
    }
  }
}
