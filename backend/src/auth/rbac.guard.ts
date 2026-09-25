import { Request } from 'express';
import { Socket } from 'socket.io';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserEntity } from '@/user/dto/user-response.dto';
import { RBAC_ACTION_KEY } from './rbac-action.decorator';
import { InstanceRole, RbacActions } from '@prisma/client';
import { PermissionsService } from '@/roles/permissions.service';
import {
  RBAC_RESOURCE_KEY,
  RbacResourceOptions,
  RbacResourceType,
  ResourceIdSource,
} from './rbac-resource.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);
  constructor(
    private readonly permissionsService: PermissionsService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRbacActions = this.getRequiredRbacActions(context);
    if (!requiredRbacActions.length) return true;

    const resourceOptions = this.getResourceOptions(context);
    const resourceId = resourceOptions
      ? this.getResourceId(context, resourceOptions)
      : undefined;
    const resourceType = resourceOptions?.type;

    const user = this.getUser(context);

    this.logRbacCheck(requiredRbacActions, user, resourceId, resourceType);

    if (!user) return false;
    if (user.role === InstanceRole.OWNER) {
      this.logger.debug('User is an owner, skipping RBAC check');
      return true;
    }

    return this.permissionsService.verifyActionsForUserAndResource(
      user.id,
      resourceId,
      resourceType,
      requiredRbacActions,
    );
  }

  private getRequiredRbacActions(context: ExecutionContext): RbacActions[] {
    return (
      this.reflector.getAllAndOverride<RbacActions[]>(RBAC_ACTION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || []
    );
  }

  private getResourceOptions(
    context: ExecutionContext,
  ): RbacResourceOptions | undefined {
    return this.reflector.getAllAndOverride<RbacResourceOptions>(
      RBAC_RESOURCE_KEY,
      [context.getHandler(), context.getClass()],
    );
  }

  private getUser(context: ExecutionContext): UserEntity | undefined {
    if (context.getType() === 'http') {
      const req: Request = context.switchToHttp().getRequest();
      return req.user as UserEntity | undefined;
    }
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient<Socket>();
      if (
        client &&
        typeof client === 'object' &&
        'handshake' in client &&
        typeof client.handshake === 'object'
      ) {
        // The JWT guard should have attached the user to the handshake
        const handshake = client.handshake as { user?: UserEntity };
        return handshake.user;
      }
    }
    return undefined;
  }

  private logRbacCheck(
    requiredRbacActions: RbacActions[],
    user: UserEntity | undefined,
    resourceId: string | undefined,
    resourceType: RbacResourceType | undefined,
  ) {
    this.logger.debug(
      `RBAC Check - User: ${user?.id}, Role: ${user?.role}, ` +
        `Actions: ${requiredRbacActions.join(',')}, ` +
        `ResourceType: ${resourceType}, ResourceID: ${resourceId}`,
    );
  }

  private getResourceId(
    context: ExecutionContext,
    resourceOptions: RbacResourceOptions,
  ): string | undefined {
    if (context.getType() === 'http') {
      const req: Request = context.switchToHttp().getRequest();
      const key = resourceOptions.idKey!;
      switch (resourceOptions.source) {
        case ResourceIdSource.BODY:
          return (req.body as Record<string, unknown>)?.[key] as
            string | undefined;
        case ResourceIdSource.QUERY:
          return req.query?.[key] as string | undefined;
        case ResourceIdSource.PARAM:
          return req.params?.[key] as string | undefined;
        case ResourceIdSource.PAYLOAD:
        case ResourceIdSource.TEXT_PAYLOAD:
          // PAYLOAD and TEXT_PAYLOAD are WebSocket-only sources
          return undefined;
        default:
          return undefined;
      }
    }
    if (context.getType() === 'ws') {
      // For WebSocket, extract from the message payload
      if (resourceOptions.source === ResourceIdSource.TEXT_PAYLOAD) {
        return context.switchToWs().getData();
      } else {
        const data: Record<string, unknown> = context.switchToWs().getData();
        return data[resourceOptions.idKey!] as string | undefined;
      }
    }
    return undefined;
  }
}
