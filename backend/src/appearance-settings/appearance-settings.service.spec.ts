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

/** The transaction client the service's interactive `$transaction` gets. */
type TransactionClient = {
  userAppearanceSettings: {
    findUnique: jest.Mock;
    upsert: jest.Mock<Promise<UserAppearanceSettings>, [UpsertArgs]>;
  };
};

describe('AppearanceSettingsService', () => {
  let service: AppearanceSettingsService;
  let databaseService: Mocked<DatabaseService>;
  let upsert: jest.Mock<Promise<UserAppearanceSettings>, [UpsertArgs]>;
  let findUnique: jest.Mock;
  let transactionClient: TransactionClient;

  const mockSettings: UserAppearanceSettings = {
    id: 'settings-1',
    userId: 'user-1',
    themeMode: 'dark',
    accentColor: 'blue',
    intensity: 'minimal',
    baseColor: '#3b82f6',
    matchSystem: false,
    newDesign: false,
    loadRemoteContent: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const defaultCreate = {
    userId: 'user-1',
    baseColor: '#8e75ff',
    accentColor: 'purple',
    matchSystem: false,
    newDesign: false,
    loadRemoteContent: true,
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(
      AppearanceSettingsService,
    ).compile();

    service = unit;
    databaseService = unitRef.get(DatabaseService);

    upsert = jest.fn();
    findUnique = jest.fn().mockResolvedValue(null);
    transactionClient = { userAppearanceSettings: { findUnique, upsert } };
    // The service calls `upsert` directly for reads and inside an interactive
    // `$transaction` for writes; replace the generated Prisma delegate with
    // this mock so its calls (and their payloads) can be asserted.
    const delegate = databaseService as unknown as {
      userAppearanceSettings: TransactionClient['userAppearanceSettings'];
      $transaction: (
        callback: (tx: TransactionClient) => Promise<UserAppearanceSettings>,
      ) => Promise<UserAppearanceSettings>;
    };
    delegate.userAppearanceSettings = transactionClient.userAppearanceSettings;
    delegate.$transaction = (callback) => callback(transactionClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserSettings', () => {
    it('creates a new row with the violet base, purple accent and both flags off', async () => {
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

    it('an accentColor alone sets baseColor to that accent primary when no row exists yet', async () => {
      findUnique.mockResolvedValue(null);
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

    it('keeps a custom baseColor when an old client repeats the stored accent', async () => {
      // The stored base is '#123456', whose nearest accent is slate: an old
      // client that echoes all three fields while changing mode or intensity
      // must not reset the user's custom colour.
      findUnique.mockResolvedValue({ accentColor: 'slate' });
      upsert.mockResolvedValue(mockSettings);

      await service.updateUserSettings('user-1', {
        themeMode: 'light',
        accentColor: 'slate',
        intensity: 'minimal',
      });

      expect(findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { accentColor: true },
      });
      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          themeMode: 'light',
          accentColor: 'slate',
          intensity: 'minimal',
        },
        update: {
          themeMode: 'light',
          accentColor: 'slate',
          intensity: 'minimal',
        },
      });
    });

    it('derives baseColor from the new accent when the accent changes', async () => {
      findUnique.mockResolvedValue({ accentColor: 'slate' });
      upsert.mockResolvedValue(mockSettings);

      await service.updateUserSettings('user-1', { accentColor: 'rose' });

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', accentColor: 'rose', baseColor: '#f43f5e' },
        update: { accentColor: 'rose', baseColor: '#f43f5e' },
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
