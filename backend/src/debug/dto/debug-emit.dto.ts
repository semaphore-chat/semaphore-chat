import { IsString, IsIn, IsObject } from 'class-validator';

export class DebugEmitDto {
  @IsString()
  event: string;

  @IsIn(['channel', 'dmGroup', 'user', 'community', 'raw'])
  roomType: 'channel' | 'dmGroup' | 'user' | 'community' | 'raw';

  @IsString()
  roomId: string;

  @IsObject()
  payload: Record<string, any>;
}
