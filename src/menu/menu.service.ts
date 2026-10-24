import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/roles';
import { unwrap } from '../common/supabase-result';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpsertMenuItemDto } from './menu.dto';

const COLUMNS =
  'id, tenant_id, name, description, price_cents, image_url, tags, is_available, voice_notes, daily_stock';

export interface MenuItemRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  price_cents: number;
  image_url: string | null;
  tags: string[];
  is_available: boolean;
  voice_notes: string | null;
  daily_stock: number | null;
}

function toColumns(dto: UpsertMenuItemDto) {
  return Object.fromEntries(
    Object.entries({
      name: dto.name,
      description: dto.description,
      price_cents: dto.priceCents,
      image_url: dto.imageUrl,
      tags: dto.tags,
      is_available: dto.isAvailable,
      voice_notes: dto.voiceNotes,
      daily_stock: dto.dailyStock,
    }).filter(([, v]) => v !== undefined),
  );
}

@Injectable()
export class MenuService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(tenantId: string): Promise<MenuItemRow[]> {
    return unwrap(
      await this.supabase.anon
        .from('menu_items')
        .select(COLUMNS)
        .eq('tenant_id', tenantId)
        .order('sort_order'),
    );
  }

  async create(user: AuthUser, tenantId: string, dto: UpsertMenuItemDto) {
    const item = unwrap(
      await this.supabase
        .forUser(user)
        .from('menu_items')
        .insert({ ...toColumns(dto), tenant_id: tenantId })
        .select(COLUMNS)
        .single<MenuItemRow>(),
    );
    this.realtime.emitMenuItemUpdated(tenantId, item);
    return item;
  }

  /** Used by the KDS 1-click toggle and the manager editor alike. */
  async update(
    user: AuthUser,
    tenantId: string,
    id: string,
    dto: UpsertMenuItemDto,
  ) {
    const item = unwrap(
      await this.supabase
        .forUser(user)
        .from('menu_items')
        .update(toColumns(dto))
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select(COLUMNS)
        .single<MenuItemRow>(),
    );
    // Customers' live menus and active voice sessions pick this up instantly.
    this.realtime.emitMenuItemUpdated(tenantId, item);
    return item;
  }
}
