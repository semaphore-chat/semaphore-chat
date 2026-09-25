import { TestBed } from '@suites/unit';
import { PrismaPg } from '@prisma/adapter-pg';
import { DatabaseService } from './database.service';

// Spy on the adapter's constructor while still building a real adapter
// (PrismaClient rejects anything else). Nothing connects until $connect().
jest.mock('@prisma/adapter-pg', () => {
  const actual =
    jest.requireActual<typeof import('@prisma/adapter-pg')>(
      '@prisma/adapter-pg',
    );
  return {
    ...actual,
    PrismaPg: jest.fn(
      (...args: ConstructorParameters<typeof actual.PrismaPg>) =>
        new actual.PrismaPg(...args),
    ),
  };
});

const TEST_DATABASE_URL = 'postgresql://u:p@db-host:5432/app';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let originalDatabaseUrl: string | undefined;

  beforeEach(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { unit } = await TestBed.solitary(DatabaseService).compile();
    service = unit;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('connects through the pg driver adapter using DATABASE_URL', () => {
    // The one construction is the TestBed's in beforeEach.
    expect(PrismaPg).toHaveBeenCalledTimes(1);
    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: TEST_DATABASE_URL,
    });
  });

  describe('onModuleInit', () => {
    it('should connect to database on module init', async () => {
      const connectSpy = jest
        .spyOn(service, '$connect')
        .mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(connectSpy).toHaveBeenCalled();

      connectSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect from database on module destroy', async () => {
      const disconnectSpy = jest
        .spyOn(service, '$disconnect')
        .mockResolvedValue(undefined);

      await service.onModuleDestroy();

      expect(disconnectSpy).toHaveBeenCalled();

      disconnectSpy.mockRestore();
    });
  });
});
