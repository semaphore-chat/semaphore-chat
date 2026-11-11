import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateMessageDto } from './create-message.dto';

export class UpdateMessageDto extends PartialType(
  OmitType(CreateMessageDto, ['clientNonce']),
) {}
