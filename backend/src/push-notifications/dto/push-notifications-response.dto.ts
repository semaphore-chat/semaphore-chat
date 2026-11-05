import { ApiProperty } from '@nestjs/swagger';

export class VapidPublicKeyResponseDto {
  publicKey: string | null;
  enabled: boolean;
}

export class PushStatusResponseDto {
  enabled: boolean;
  @ApiProperty({ type: 'integer' })
  subscriptionCount: number;
}

export class PushSubscriptionInfoDto {
  id: string;
  /** Host of the push service; the full endpoint URL is never returned. */
  endpointHost: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TestPushResponseDto {
  success: boolean;
  @ApiProperty({ type: 'integer' })
  sent: number;
  @ApiProperty({ type: 'integer' })
  failed: number;
  message: string;
}
