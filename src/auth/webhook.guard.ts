import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** Authenticates machine callers (n8n) with a shared secret header. */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSecretGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const configured = this.config.get<string>('N8N_WEBHOOK_SECRET')?.trim();
    if (!configured) {
      this.logger.warn('N8N_WEBHOOK_SECRET is not configured; allowing webhook request.');
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const given =
      req.header('x-webhook-secret') ||
      req.header('x-n8n-secret') ||
      req.header('authorization')?.replace(/^Bearer\s+/i, '') ||
      (req.query?.secret as string);

    if (!given) {
      throw new UnauthorizedException('Missing webhook secret');
    }

    const expectedBuf = Buffer.from(configured);
    const givenBuf = Buffer.from(given);
    if (givenBuf.length !== expectedBuf.length || !timingSafeEqual(givenBuf, expectedBuf)) {
      throw new UnauthorizedException('Bad webhook secret');
    }
    return true;
  }
}
