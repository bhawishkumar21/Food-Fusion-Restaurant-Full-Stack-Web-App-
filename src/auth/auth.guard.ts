import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators';
import type { AuthUser } from './roles';
import { TokenVerifier } from './token-verifier.service';

/** Global guard #1: every route is authenticated unless marked @Public(). */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    req.user = await this.verifier.verify(token);
    return true;
  }
}
