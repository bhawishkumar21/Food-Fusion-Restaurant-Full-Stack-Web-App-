import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import { Role } from '../auth/roles';
import type { AuthUser } from '../auth/roles';
import { CreateOrderDto, UpdateOrderStatusDto } from './orders.dto';
import { OrdersService } from './orders.service';

@Controller('t/:tenantId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Any signed-in user (including Supabase anonymous sign-ins) can order. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.orders.create(user, tenantId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('active', new ParseBoolPipe({ optional: true })) active = false,
  ) {
    return this.orders.list(user, tenantId, active);
  }

  @Roles(Role.SuperAdmin)
  @Get('admin/active')
  adminActive(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.orders.listForAdmin(user, tenantId);
  }

  @Roles(Role.SuperAdmin)
  @Patch(':id/complete')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.complete(user, tenantId, id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.findOne(user, id);
  }

  @Patch(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.cancel(user, tenantId, id);
  }

  /** KDS kanban moves: new → preparing → ready → completed. */
  @Roles(Role.Staff)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(user, tenantId, id, dto);
  }
}
