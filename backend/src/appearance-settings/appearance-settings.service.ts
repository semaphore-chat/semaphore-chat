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
   * `accentColor` in the same request is ignored), while a *changed*
   * `accentColor` derives `baseColor` from the accent's primary.
   *
   * An accent equal to the stored one changes nothing: older clients PATCH all
   * three fields on every mode or intensity change, and that echo must not
   * reset a custom base colour. The read and the write share one transaction.
   */
  async updateUserSettings(
    userId: string,
    dto: UpdateAppearanceSettingsDto,
  ): Promise<UserAppearanceSettings> {
    return this.databaseService.$transaction(async (tx) => {
      let data: UpdateAppearanceSettingsDto = dto;
      if (dto.baseColor !== undefined) {
        data = { ...dto, accentColor: nearestAccent(dto.baseColor) };
      } else if (dto.accentColor !== undefined) {
        const stored = await tx.userAppearanceSettings.findUnique({
          where: { userId },
          select: { accentColor: true },
        });
        if (stored?.accentColor !== dto.accentColor) {
          data = {
            ...dto,
            baseColor: ACCENT_PRIMARY[dto.accentColor as AccentName],
          };
        }
      }

      return tx.userAppearanceSettings.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    });
  }
}
