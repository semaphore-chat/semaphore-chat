import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import type { UserAppearanceSettings } from '@prisma/client';
import { AppearanceSettingsService } from './appearance-settings.service';
import { DatabaseService } from '@/database/database.service';

type UpsertArgs = {
  where: { userId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

describe('AppearanceSettingsService', () => {
  let service: AppearanceSettingsService;
  let databaseService: Mocked<DatabaseService>;
  let upsert: jest.Mock<Promise<UserAppearanceSettings>, [UpsertArgs]>;

  const mockSettings: UserAppearanceSettings = {
    id: 'settings-1',
    userId: 'user-1',
    themeMode: 'dark',
    accentColor: 'blue',
    intensity: 'minimal',
    baseColor: '#3b82f6',
    matchSystem: false,
    newDesign: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const defaultCreate = {
    userId: 'user-1',
    baseColor: '#8e75ff',
    accentColor: 'purple',
    matchSystem: false,
    newDesign: false,
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      AppearanceSettingsService,
    ).compile();

    service = unit;
    databaseService = unitRef.get(DatabaseService);

    upsert = jest.fn();
    // The service only calls `upsert`; replace the generated Prisma delegate
    // with this mock so its calls (and their payloads) can be asserted.
    (
      databaseService as unknown as {
        userAppearanceSettings: { upsert: typeof upsert };
      }
    ).userAppearanceSettings = { upsert };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserSettings', () => {
    it('returns settings via upsert', async () => {
      upsert.mockResolvedValue(mockSettings);

      const result = await service.getUserSettings('user-1');

      expect(result).toBe(mockSettings);
      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: defaultCreate,
        update: {},
      });
    });

    it('passes the correct userId to upsert', async () => {
      upsert.mockResolvedValue(mockSettings);

      await service.getUserSettings('user-42');

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-42' },
        create: { ...defaultCreate, userId: 'user-42' },
        update: {},
      });
    });

    it('creates a new row with the violet base, purple accent and both flags off', async () => {
      upsert.mockResolvedValue({ ...mockSettings, ...defaultCreate });

      const result = await service.getUserSettings('user-1');

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: defaultCreate,
        update: {},
      });
      expect(result.baseColor).toBe('#8e75ff');
      expect(result.accentColor).toBe('purple');
      expect(result.matchSystem).toBe(false);
      expect(result.newDesign).toBe(false);
    });
  });

  describe('updateUserSettings', () => {
    it('upserts with the provided DTO when neither colour is sent', async () => {
      upsert.mockResolvedValue({ ...mockSettings, themeMode: 'light' });

      const result = await service.updateUserSettings('user-1', {
        themeMode: 'light',
      });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', themeMode: 'light' },
        update: { themeMode: 'light' },
      });
      expect(result.themeMode).toBe('light');
    });

    it('passes the boolean flags through unchanged', async () => {
      upsert.mockResolvedValue(mockSettings);

      const dto = { matchSystem: true, newDesign: true };
      await service.updateUserSettings('user-1', dto);

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', ...dto },
        update: dto,
      });
    });

    it('a baseColor sets accentColor to its nearest accent', async () => {
      upsert.mockResolvedValue(mockSettings);

      await service.updateUserSettings('user-1', { baseColor: '#0d9488' });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          baseColor: '#0d9488',
          accentColor: 'teal',
        },
        update: { baseColor: '#0d9488', accentColor: 'teal' },
      });
    });

    it('nearestAccent resolves a violet base to purple', async () => {
      upsert.mockResolvedValue(mockSettings);

      await service.updateUserSettings('user-1', { baseColor: '#8e75ff' });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          baseColor: '#8e75ff',
          accentColor: 'purple',
        },
        update: { baseColor: '#8e75ff', accentColor: 'purple' },
      });
    });

    it('baseColor wins over an accentColor in the same request', async () => {
      upsert.mockResolvedValue(mockSettings);

      await service.updateUserSettings('user-1', {
        baseColor: '#8b5cf6',
        accentColor: 'red',
      });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          baseColor: '#8b5cf6',
          accentColor: 'purple',
        },
        update: { baseColor: '#8b5cf6', accentColor: 'purple' },
      });
    });

    it('an accentColor alone sets baseColor to that accent primary', async () => {
      upsert.mockResolvedValue(mockSettings);

      await service.updateUserSettings('user-1', { accentColor: 'slate' });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          accentColor: 'slate',
          baseColor: '#64748b',
        },
        update: { accentColor: 'slate', baseColor: '#64748b' },
      });
    });

    it('leaves both colour fields unchanged when neither is sent', async () => {
      upsert.mockResolvedValue(mockSettings);

      await service.updateUserSettings('user-1', {
        themeMode: 'dark',
        intensity: 'vibrant',
      });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          themeMode: 'dark',
          intensity: 'vibrant',
        },
        update: { themeMode: 'dark', intensity: 'vibrant' },
      });
    });
  });
});
