import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { hasRole, Role } from '../auth/roles';
import type { AuthUser } from '../auth/roles';
import { ToggleAvailabilityDto, UpsertMenuItemDto } from './menu.dto';
import { MenuService } from './menu.service';

@Controller('t/:tenantId/menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Public()
  @Get()
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.menu.list(tenantId);
  }

  /**
   * KDS 1-click out-of-stock toggle (staff+). Setting the daily portion count
   * is inventory management: managers and the owner only.
   */
  @Roles(Role.Staff)
  @Patch(':id/availability')
  toggle(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ToggleAvailabilityDto,
  ) {
    if (dto.dailyStock !== undefined && !hasRole(user.role, Role.Manager)) {
      throw new ForbiddenException('Only managers can set daily stock');
    }
    return this.menu.update(user, tenantId, id, {
      isAvailable: dto.isAvailable,
      dailyStock: dto.dailyStock,
    });
  }

  @Roles(Role.SuperAdmin)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpsertMenuItemDto,
  ) {
    return this.menu.create(user, tenantId, dto);
  }

  /** Owner's menu editor: price, copy, tags, voice notes. */
  @Roles(Role.SuperAdmin)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertMenuItemDto,
  ) {
    return this.menu.update(user, tenantId, id, dto);
  }
}
