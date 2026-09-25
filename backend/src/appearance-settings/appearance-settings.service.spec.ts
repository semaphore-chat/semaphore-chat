import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { AppearanceSettingsService } from './appearance-settings.service';
import { DatabaseService } from '@/database/database.service';

describe('AppearanceSettingsService', () => {
  let service: AppearanceSettingsService;
  let databaseService: Mocked<DatabaseService>;

  const mockSettings = {
    id: 'settings-1',
    userId: 'user-1',
    themeMode: 'dark',
    accentColor: 'blue',
    intensity: 'minimal',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      AppearanceSettingsService,
    ).compile();

    service = unit;
    databaseService = unitRef.get(DatabaseService);

    (databaseService.userAppearanceSettings as any) = {
      upsert: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserSettings', () => {
    it('returns settings via upsert', async () => {
      (databaseService.userAppearanceSettings as any).upsert.mockResolvedValue(
        mockSettings,
      );

      const result = await service.getUserSettings('user-1');

      expect(result).toBe(mockSettings);
      expect(
        databaseService.userAppearanceSettings.upsert,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1' },
        update: {},
      });
    });

    it('passes the correct userId to upsert', async () => {
      (databaseService.userAppearanceSettings as any).upsert.mockResolvedValue(
        mockSettings,
      );

      await service.getUserSettings('user-42');

      expect(
        databaseService.userAppearanceSettings.upsert,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-42' },
        create: { userId: 'user-42' },
        update: {},
      });
    });
  });

  describe('updateUserSettings', () => {
    it('upserts with the provided DTO', async () => {
      (databaseService.userAppearanceSettings as any).upsert.mockResolvedValue({
        ...mockSettings,
        themeMode: 'light',
      });

      const result = await service.updateUserSettings('user-1', {
        themeMode: 'light',
      });

      expect(
        databaseService.userAppearanceSettings.upsert,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', themeMode: 'light' },
        update: { themeMode: 'light' },
      });
      expect(result.themeMode).toBe('light');
    });

    it('passes multiple DTO fields to upsert', async () => {
      (databaseService.userAppearanceSettings as any).upsert.mockResolvedValue(
        mockSettings,
      );

      const dto = { themeMode: 'dark', accentColor: 'purple' };
      await service.updateUserSettings('user-1', dto);

      expect(
        databaseService.userAppearanceSettings.upsert,
      ).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', ...dto },
        update: dto,
      });
    });
  });
});
