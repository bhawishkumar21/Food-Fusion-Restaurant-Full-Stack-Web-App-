import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from '../auth/roles';

@Injectable()
export class SupabaseService {
  private readonly url: string;
  private readonly anonKey: string;
  /** Bypasses RLS. Only for webhooks, the realtime gateway and super-admin ops. */
  readonly admin: SupabaseClient;
  /** Unauthenticated client for public reads (subject to `anon` RLS policies). */
  readonly anon: SupabaseClient;

  constructor(config: ConfigService) {
    this.url = config.getOrThrow('SUPABASE_URL');
    this.anonKey = config.getOrThrow('SUPABASE_ANON_KEY');
    this.anon = createClient(this.url, this.anonKey, {
      auth: { persistSession: false },
    });
    this.admin = createClient(
      this.url,
      config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } },
    );
  }

  /** A client that acts *as the caller*, so Postgres RLS policies apply. */
  forUser(user: AuthUser): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
    });
  }
}
