import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Unwraps a Supabase response. RLS denials surface as "no rows", so a missing
 * row is reported as 404 rather than leaking whether it exists in another tenant.
 */
export function unwrap<T>(res: {
  data: T | null;
  error: PostgrestError | null;
}): T {
  if (res.error) {
    if (res.error.code === 'PGRST116') throw new NotFoundException();
    throw new InternalServerErrorException(res.error.message);
  }
  if (res.data === null) throw new NotFoundException();
  return res.data;
}
