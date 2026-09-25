import { Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  // Re-declared so AuthModuleOptions stays optional: Nest 12 doesn't inherit
  // a parent's @Optional() constructor markers (see OptionalJwtAuthGuard).
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }
}
