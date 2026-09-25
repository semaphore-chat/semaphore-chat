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

describe('DatabaseService', () => {
  let service: DatabaseService;

  beforeEach(async () => {
    const { unit } = await TestBed.solitary(DatabaseService).compile();
    service = unit;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('connects through the pg driver adapter using DATABASE_URL', () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@db-host:5432/app';
    try {
      jest.mocked(PrismaPg).mockClear();
      new DatabaseService();
      expect(PrismaPg).toHaveBeenCalledTimes(1);
      expect(PrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://u:p@db-host:5432/app',
      });
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
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
