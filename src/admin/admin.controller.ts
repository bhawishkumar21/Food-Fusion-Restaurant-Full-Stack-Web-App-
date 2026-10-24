import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Roles } from '../auth/decorators';
import { Role } from '../auth/roles';
import { unwrap } from '../common/supabase-result';
import { SupabaseService } from '../supabase/supabase.service';

class CreateTenantDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @Matches(/^[a-z0-9-]{3,40}$/)
  slug: string;

  @IsIn(['starter', 'growth', 'enterprise'])
  plan: 'starter' | 'growth' | 'enterprise';
}

class UpdateTenantDto {
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  @IsOptional()
  @IsIn(['starter', 'growth', 'enterprise'])
  plan?: 'starter' | 'growth' | 'enterprise';
}

/**
 * Cross-tenant operations. Uses the service-role client deliberately; the
 * class-level @Roles(SuperAdmin) is the gate (RLS also grants super_admin).
 */
@Roles(Role.SuperAdmin)
@Controller('admin')
export class AdminController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('tenants')
  async tenants() {
    return unwrap(
      await this.supabase.admin
        .from('tenant_overview')
        .select('*')
        .order('created_at', { ascending: false }),
    );
  }

  @Post('tenants')
  async createTenant(@Body() dto: CreateTenantDto) {
    return unwrap(
      await this.supabase.admin.from('tenants').insert(dto).select().single(),
    );
  }

  @Patch('tenants/:id')
  async updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return unwrap(
      await this.supabase.admin
        .from('tenants')
        .update(dto)
        .eq('id', id)
        .select()
        .single(),
    );
  }

  @Get('logs')
  async logs(
    @Query('level') level?: 'info' | 'warn' | 'error',
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
  ) {
    let q = this.supabase.admin
      .from('api_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 500));
    if (level) q = q.eq('level', level);
    return unwrap(await q);
  }

  @Get('usage')
  async usage(
    @Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number,
  ) {
    return unwrap(
      await this.supabase.admin.rpc('api_usage_summary', {
        p_days: Math.min(days, 90),
      }),
    );
  }
}
