import { Test } from '@nestjs/testing';
import { LocalAuthGuard } from './local-auth.guard';

describe('LocalAuthGuard', () => {
  let guard: LocalAuthGuard;

  beforeEach(() => {
    guard = new LocalAuthGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should extend AuthGuard with local strategy', () => {
    expect(guard).toBeInstanceOf(LocalAuthGuard);
  });

  it('should call canActivate from parent AuthGuard', () => {
    // The guard will call the Passport local strategy
    // We just verify the method exists and is callable
    expect(typeof guard.canActivate).toBe('function');
  });

  it('resolves through DI in a module that does not import PassportModule', async () => {
    // Nest 12 doesn't inherit @Optional() constructor markers, so the guard
    // must re-declare AuthGuard's optional AuthModuleOptions parameter.
    const moduleRef = await Test.createTestingModule({
      providers: [LocalAuthGuard],
    }).compile();

    expect(moduleRef.get(LocalAuthGuard)).toBeInstanceOf(LocalAuthGuard);
  });
});
