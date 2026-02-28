import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { SignedUrlService } from './signed-url.service';
import { DatabaseService } from '@/database/database.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Request } from 'express';

@Injectable()
export class FileAuthGuard implements CanActivate {
  constructor(
    private readonly signedUrlService: SignedUrlService,
    private readonly databaseService: DatabaseService,
    private readonly jwtAuthGuard: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const sig = typeof req.query.sig === 'string' ? req.query.sig : undefined;
    const exp = typeof req.query.exp === 'string' ? req.query.exp : undefined;
    const uid = typeof req.query.uid === 'string' ? req.query.uid : undefined;

    if (sig && exp && uid) {
      const fileId = req.params.id as string;
      const expNum = parseInt(exp, 10);

      if (isNaN(expNum)) {
        throw new UnauthorizedException('Invalid signed URL');
      }

      const valid = this.signedUrlService.verify(fileId, sig, expNum, uid);
      if (!valid) {
        throw new UnauthorizedException('Invalid or expired signed URL');
      }

      const user = await this.databaseService.user.findUnique({
        where: { id: uid },
      });

      if (!user || user.banned) {
        throw new UnauthorizedException('User not found or banned');
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (req as any).user = user;
      return true;
    }

    return this.jwtAuthGuard.canActivate(context) as Promise<boolean>;
  }
}
