import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { Role } from '../auth/roles';
import type { AuthUser } from '../auth/roles';
import { unwrap } from '../common/supabase-result';
import { SupabaseService } from '../supabase/supabase.service';

export const FUNNEL_STAGES = [
  'menu_view',
  'cart_add',
  'checkout_open',
  'order_placed',
] as const;

class FunnelEventDto {
  @IsString()
  @MaxLength(64)
  sessionId: string;

  @IsIn(FUNNEL_STAGES)
  stage: (typeof FUNNEL_STAGES)[number];
}

@Controller('t/:tenantId')
export class AnalyticsController {
  constructor(private readonly supabase: SupabaseService) {}

  /** Anonymous funnel beacons used to compute order drop-off. */
  @Public()
  @Post('events')
  async track(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: FunnelEventDto,
  ) {
    const { error } = await this.supabase.anon.from('site_analytics').insert({
      tenant_id: tenantId,
      session_id: dto.sessionId,
      stage: dto.stage,
    });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  /** Revenue, drop-off funnel and AI sentiment split (owner only: financial data). */
  @Roles(Role.SuperAdmin)
  @Get('analytics/summary')
  async summary(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return unwrap(
      await this.supabase.forUser(user).rpc('tenant_analytics', {
        p_tenant_id: tenantId,
        p_days: Math.min(Math.max(days, 1), 365),
      }),
    );
  }
}
