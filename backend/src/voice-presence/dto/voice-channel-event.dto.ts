import { IsNotEmpty, IsString } from 'class-validator';

export class VoiceChannelEventDto {
  @IsString()
  @IsNotEmpty()
  channelId: string;
}
