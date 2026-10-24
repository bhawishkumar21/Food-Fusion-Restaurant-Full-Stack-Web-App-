import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { AuthUser } from '../auth/roles';
import { SupabaseService } from '../supabase/supabase.service';

interface ApiLogRow {
  tenant_id: string | null;
  user_id: string | null;
  method: string;
  route: string;
  status: number;
  duration_ms: number;
  level: 'info' | 'warn' | 'error';
}

/**
 * Records every API call for the Super Admin usage & log views. Rows are
 * buffered and flushed in batches so logging never adds a DB round-trip
 * to the request path.
 */
@Injectable()
export class ApiUsageInterceptor implements NestInterceptor, OnModuleDestroy {
  private readonly logger = new Logger(ApiUsageInterceptor.name);
  private buffer: ApiLogRow[] = [];
  private readonly timer = setInterval(() => void this.flush(), 5000);

  constructor(private readonly supabase: SupabaseService) {
    this.timer.unref();
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthUser }>();
    const started = performance.now();

    const record = (status: number) => {
      this.buffer.push({
        tenant_id:
          (req.params?.tenantId as string | undefined) ??
          req.user?.tenantId ??
          null,
        user_id: req.user?.id ?? null,
        method: req.method,
        // Route template (not the concrete URL) keeps cardinality low.
        route: (req.route as { path?: string } | undefined)?.path ?? req.path,
        status,
        duration_ms: Math.round(performance.now() - started),
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      });
      if (this.buffer.length >= 200) void this.flush();
    };

    return next.handle().pipe(
      tap({
        next: () => record(http.getResponse<Response>().statusCode),
        error: (err: { status?: number }) => record(err?.status ?? 500),
      }),
    );
  }

  private async flush() {
    if (!this.buffer.length) return;
    const rows = this.buffer;
    this.buffer = [];
    const { error } = await this.supabase.admin.from('api_logs').insert(rows);
    if (error)
      this.logger.warn(`Dropped ${rows.length} logs: ${error.message}`);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flush();
  }
}
