import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { Roles } from '../auth/decorators';
import {
  ASSIGNABLE_ROLES,
  isSuperAdminEmail,
  resolveRole,
  Role,
} from '../auth/roles';
import { SupabaseService } from '../supabase/supabase.service';

class UpdateUserRoleDto {
  /** Super admin is hardcoded to one email and can never be assigned. */
  @IsIn(ASSIGNABLE_ROLES)
  role: (typeof ASSIGNABLE_ROLES)[number];

  /** Managers and staff work for one restaurant. */
  @ValidateIf((o: UpdateUserRoleDto) => o.role !== Role.User)
  @IsUUID()
  @IsOptional()
  tenantId?: string;
}

export interface UserSummary {
  id: string;
  email: string | null;
  role: Role;
  tenantId: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  /** True for the hardcoded super-admin account (role is locked). */
  locked: boolean;
}

/**
 * /admin/users — super admin only. Roles live in `app_metadata`, which only
 * the service role can write, so promotions happen here and nowhere else.
 * The database trigger `assign_app_role` re-checks every write as well.
 */
@Roles(Role.SuperAdmin)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly supabase: SupabaseService) {}

  /** Search registered users by email (substring, case-insensitive). */
  @Get()
  async search(@Query('q') q = ''): Promise<UserSummary[]> {
    const needle = q.trim().toLowerCase();
    const users = [];
    // Supabase's admin API has no email search: page through and filter.
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await this.supabase.admin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error) throw new InternalServerErrorException(error.message);
      users.push(...data.users);
      if (data.users.length < 1000) break;
    }
    return users
      .filter(
        (u) =>
          !u.is_anonymous &&
          (!needle || (u.email ?? '').toLowerCase().includes(needle)),
      )
      .slice(0, 100)
      .map((u) => ({
        id: u.id,
        email: u.email ?? null,
        role: resolveRole(u.email, u.app_metadata?.role),
        tenantId: (u.app_metadata?.tenant_id as string | undefined) ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at,
        locked: isSuperAdminEmail(u.email),
      }));
  }

  @Patch(':userId/role')
  async setRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    const existing = await this.supabase.admin.auth.admin.getUserById(userId);
    if (existing.error || !existing.data.user) throw new NotFoundException();
    if (isSuperAdminEmail(existing.data.user.email)) {
      throw new ForbiddenException(
        'The super admin account is hardcoded and cannot be changed',
      );
    }
    if (dto.role !== Role.User && !dto.tenantId) {
      throw new BadRequestException(
        'Managers and staff must be assigned to a restaurant',
      );
    }
    const { error } = await this.supabase.admin.auth.admin.updateUserById(
      userId,
      {
        app_metadata: {
          ...existing.data.user.app_metadata,
          role: dto.role,
          tenant_id: dto.role === Role.User ? null : dto.tenantId,
        },
      },
    );
    if (error) throw new InternalServerErrorException(error.message);
    // New claims apply on the user's next token refresh (≤ 1 hour).
    return { id: userId, role: dto.role };
  }
}
