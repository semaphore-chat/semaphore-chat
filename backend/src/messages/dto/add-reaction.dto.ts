import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';

export class AddReactionDto {
  @IsNotEmpty()
  @IsString()
  @IsUUID()
  messageId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  emoji: string;
}
