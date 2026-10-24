import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, Roles } from '../auth/decorators';
import { Role } from '../auth/roles';
import type { AuthUser } from '../auth/roles';
import { unwrap } from '../common/supabase-result';
import { SupabaseService } from '../supabase/supabase.service';

export const RESERVATION_STATUSES = [
  'requested',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
] as const;

class CreateReservationDto {
  @IsDateString()
  reservedFor: string;

  @IsInt()
  @Min(1)
  @Max(30)
  partySize: number;

  @IsString()
  @MaxLength(80)
  guestName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

class UpdateReservationDto {
  @IsIn(RESERVATION_STATUSES)
  status: (typeof RESERVATION_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  tableLabel?: string;
}

const COLUMNS =
  'id, tenant_id, customer_id, reserved_for, party_size, guest_name, phone, notes, status, table_label, created_at';

/**
 * Table reservations. Customers create and see their own (RLS); managers and
 * owners see and run the day's book for their restaurant.
 */
@Controller('t/:tenantId/reservations')
export class ReservationsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateReservationDto,
  ) {
    return unwrap(
      await this.supabase
        .forUser(user)
        .from('reservations')
        .insert({
          tenant_id: tenantId,
          customer_id: user.id,
          reserved_for: dto.reservedFor,
          party_size: dto.partySize,
          guest_name: dto.guestName,
          phone: dto.phone ?? null,
          notes: dto.notes ?? null,
        })
        .select(COLUMNS)
        .single(),
    );
  }

  /** RLS returns the caller's own bookings, or the whole book for staff. */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('date') date?: string,
  ) {
    let q = this.supabase
      .forUser(user)
      .from('reservations')
      .select(COLUMNS)
      .eq('tenant_id', tenantId)
      .order('reserved_for');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      q = q
        .gte('reserved_for', `${date}T00:00:00Z`)
        .lt('reserved_for', `${date}T23:59:59.999Z`);
    }
    return unwrap(await q);
  }

  @Roles(Role.Manager)
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return unwrap(
      await this.supabase
        .forUser(user)
        .from('reservations')
        .update({
          status: dto.status,
          ...(dto.tableLabel !== undefined && { table_label: dto.tableLabel }),
        })
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select(COLUMNS)
        .single(),
    );
  }
}
