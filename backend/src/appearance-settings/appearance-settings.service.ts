import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { UserAppearanceSettings } from '@prisma/client';
import { ACCENT_PRIMARY, nearestAccent } from '@semaphore-chat/shared';
import type { AccentName } from '@semaphore-chat/shared';
import { UpdateAppearanceSettingsDto } from './dto/update-appearance-settings.dto';

/** The base colour every new appearance row starts from (the Lounge violet). */
const DEFAULT_BASE_COLOR = '#8e75ff';

@Injectable()
export class AppearanceSettingsService {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Get user appearance settings (creates default if missing)
   */
  async getUserSettings(userId: string): Promise<UserAppearanceSettings> {
    return this.databaseService.userAppearanceSettings.upsert({
      where: { userId },
      create: {
        userId,
        baseColor: DEFAULT_BASE_COLOR,
        accentColor: nearestAccent(DEFAULT_BASE_COLOR),
        matchSystem: false,
        newDesign: false,
      },
      update: {},
    });
  }

  /**
   * Update user appearance settings
   *
   * The two colour fields are kept consistent here, once, so every client sees
   * the same result: a `baseColor` wins and derives `accentColor` (an
   * `accentColor` in the same request is ignored), while an `accentColor` on
   * its own derives `baseColor` from the accent's primary.
   */
  async updateUserSettings(
    userId: string,
    dto: UpdateAppearanceSettingsDto,
  ): Promise<UserAppearanceSettings> {
    let data: UpdateAppearanceSettingsDto = dto;
    if (dto.baseColor !== undefined) {
      data = { ...dto, accentColor: nearestAccent(dto.baseColor) };
    } else if (dto.accentColor !== undefined) {
      data = {
        ...dto,
        baseColor: ACCENT_PRIMARY[dto.accentColor as AccentName],
      };
    }

    return this.databaseService.userAppearanceSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
