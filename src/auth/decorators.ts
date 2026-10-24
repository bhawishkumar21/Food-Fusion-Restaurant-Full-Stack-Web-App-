import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser, Role } from './roles';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Skip authentication entirely (public menu, health checks, webhooks with their own guard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Require any one of the given roles (role inheritance applies, see roles.ts). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);
