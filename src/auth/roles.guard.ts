import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { AuthUser, hasRole, Role, TENANT_SCOPED_ROLES } from './roles';

/**
 * Global guard #2 (runs after SupabaseAuthGuard):
 *  1. Enforces @Roles(...) with role inheritance.
 *  2. Enforces tenant isolation: managers may only touch `/t/:tenantId/...`
 *     routes for their own restaurant. Super admins (owners) may touch any.
 * RLS in Postgres enforces the same rules again — this is defence in depth.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const req = ctx
      .switchToHttp()
      .getRequest<Request<{ tenantId?: string }> & { user: AuthUser }>();
    const { user } = req;

    const required = this.reflector.getAllAndOverride<Role[]>(
      ROLES_KEY,
      targets,
    );
    if (required?.length && !required.some((r) => hasRole(user.role, r))) {
      throw new ForbiddenException(`Requires role: ${required.join(' | ')}`);
    }

    const tenantId = req.params.tenantId;
    if (
      tenantId &&
      TENANT_SCOPED_ROLES.has(user.role) &&
      user.tenantId !== tenantId
    ) {
      throw new ForbiddenException('Cross-tenant access denied');
    }
    return true;
  }
}
