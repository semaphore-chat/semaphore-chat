import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class SignedUrlService {
  private readonly secret: string;

  constructor(configService: ConfigService) {
    const secret =
      configService.get<string>('FILE_SIGNING_SECRET') ??
      configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET or FILE_SIGNING_SECRET must be set');
    }
    this.secret = secret;
  }

  sign(fileId: string, userId: string, expiresAt: number): string {
    const data = `${fileId}:${userId}:${expiresAt}`;
    return createHmac('sha256', this.secret).update(data).digest('hex');
  }

  verify(fileId: string, sig: string, exp: number, uid: string): boolean {
    if (Date.now() / 1000 > exp) {
      return false;
    }

    const expectedSig = this.sign(fileId, uid, exp);
    if (sig.length !== expectedSig.length) {
      return false;
    }

    const sigBuffer = Buffer.from(sig, 'hex');
    const expectedBuffer = Buffer.from(expectedSig, 'hex');
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(sigBuffer, expectedBuffer);
  }

  generateSignedUrl(
    baseUrl: string,
    fileId: string,
    userId: string,
    ttlSeconds = 3600,
  ): { url: string; expiresAt: Date } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(fileId, userId, exp);
    const url = `${baseUrl}?sig=${sig}&exp=${exp}&uid=${userId}`;
    return { url, expiresAt: new Date(exp * 1000) };
  }
}
