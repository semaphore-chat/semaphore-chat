import { IsString, IsNotEmpty } from 'class-validator';

export class RemoveParticipantDto {
  @IsString()
  @IsNotEmpty()
  participantIdentity: string;
}
