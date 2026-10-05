import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RbacActions } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Public } from '@/auth/public.decorator';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { AuthenticatedRequest } from '@/types';
import { WebhooksService } from './webhooks.service';
import { WebhookThrottlerGuard } from './webhook-throttler.guard';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { ExecuteWebhookDto } from './dto/execute-webhook.dto';
import {
  CreateWebhookResponseDto,
  ExecuteWebhookResponseDto,
  WebhookDto,
} from './dto/webhook-response.dto';

/**
 * Channel-scoped webhook management, gated by MANAGE_WEBHOOKS (community-
 * scoped: per-channel overwrites never apply to it).
 */
@Controller('channels/:channelId/webhooks')
@UseGuards(JwtAuthGuard, RbacGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @HttpCode(201)
  @RequiredActions(RbacActions.MANAGE_WEBHOOKS)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  @ApiCreatedResponse({ type: CreateWebhookResponseDto })
  create(
    @Param('channelId') channelId: string,
    @Body() dto: CreateWebhookDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreateWebhookResponseDto> {
    return this.webhooksService.create(channelId, dto, req.user.id);
  }

  @Get()
  @RequiredActions(RbacActions.MANAGE_WEBHOOKS)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [WebhookDto] })
  findAllForChannel(
    @Param('channelId') channelId: string,
  ): Promise<WebhookDto[]> {
    return this.webhooksService.listForChannel(channelId);
  }

  @Delete(':webhookId')
  @HttpCode(204)
  @RequiredActions(RbacActions.MANAGE_WEBHOOKS)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  remove(
    @Param('channelId') channelId: string,
    @Param('webhookId') webhookId: string,
  ): Promise<void> {
    return this.webhooksService.remove(channelId, webhookId);
  }
}

/**
 * Public webhook execution endpoint. No JWT/RBAC — authentication is the
 * per-webhook token embedded in the URL, verified inside WebhooksService.
 */
@Controller('webhooks')
export class WebhookExecutionController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(':id/:token')
  @HttpCode(201)
  @Public()
  @Throttle({ short: { limit: 4, ttl: 1000 }, long: { limit: 30, ttl: 60000 } })
  // Per-webhook-identity limit, independent of the per-IP tiers above — see
  // WebhookThrottlerGuard for how the two dimensions stay isolated.
  @UseGuards(WebhookThrottlerGuard)
  @ApiCreatedResponse({ type: ExecuteWebhookResponseDto })
  execute(
    @Param('id') id: string,
    @Param('token') token: string,
    @Body() dto: ExecuteWebhookDto,
  ): Promise<ExecuteWebhookResponseDto> {
    return this.webhooksService.execute(id, token, dto.content);
  }
}
