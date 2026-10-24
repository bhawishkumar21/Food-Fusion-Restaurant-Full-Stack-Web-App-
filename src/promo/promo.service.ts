import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { SupabaseService } from '../supabase/supabase.service';

/** Canonical stored form: "  thankyou10 - gwbwk " → "THANKYOU10-GWBWK". */
export const normalizeCode = (code: string) =>
  code.trim().toUpperCase().replace(/\s*-\s*/g, '-');

const CODE_FORMAT = /^[A-Z0-9_-]{3,32}$/;
// No 0/O/1/I, so a code read out of an email is typed correctly.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface PromoRow {
  code: string;
  tenant_id: string;
  discount_percentage: number;
  is_used: boolean;
  used_at: string | null;
  expires_at: string | null;
  source: string;
  feedback_id: string | null;
}

export interface IssuedCode {
  code: string;
  discount_percentage: number;
  expires_at: string | null;
}

/**
 * Promo codes live in public.promo_codes (and public.coupons).
 * Checkout redeems them atomically in Postgres (place_order → redeem_promo_code);
 * this service issues apology/referral codes and provides transparent console/logger logs
 * explaining why a promo code succeeded or failed validation.
 */
@Injectable()
export class PromoService {
  private readonly logger = new Logger(PromoService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  /** Discount and lifetime for apology codes (env-tunable). */
  compensationTerms() {
    return {
      percent: Number(this.config.get('COMPENSATION_DISCOUNT_PERCENT') ?? 20),
      days: Number(this.config.get('COMPENSATION_VALID_DAYS') ?? 30),
      maxRating: Number(this.config.get('COMPENSATION_MAX_RATING') ?? 2),
      defaultTenantId:
        this.config.get('DEFAULT_TENANT_ID') ??
        'f00df051-0000-4000-8000-000000000001',
    };
  }

  /** Terms for thank-you / referral discount codes issued for positive 5-star reviews. */
  referralTerms() {
    return {
      percent: Number(this.config.get('REFERRAL_DISCOUNT_PERCENT') ?? 10),
      days: Number(this.config.get('REFERRAL_VALID_DAYS') ?? 30),
      minRating: Number(this.config.get('REFERRAL_MIN_RATING') ?? 4),
      defaultTenantId:
        this.config.get('DEFAULT_TENANT_ID') ??
        'f00df051-0000-4000-8000-000000000001',
    };
  }

  /**
   * Helper to issue a 10% thank-you/referral promo code for positive reviews.
   */
  async issueReferral(input: Parameters<PromoService['issueCompensation']>[0]): Promise<IssuedCode> {
    const terms = this.referralTerms();
    const raw =
      input.code ||
      input.referral_code ||
      input.referralCode ||
      input.thankyou_code ||
      input.thankyouCode ||
      input.thank_you_code ||
      input.promo_code ||
      input.promoCode;

    return this.issueCompensation({
      ...input,
      percent: input.percent ?? terms.percent,
      validDays: input.validDays ?? terms.days,
      source: input.source ?? 'referral',
      code: raw ?? `THANKYOU${terms.percent}-${randomSuffix(5)}`,
    });
  }

  /**
   * Saves a single-use apology or referral code so checkout can redeem it.
   * Idempotent per review: a retried workflow gets the same code back instead of a new one.
   */
  async issueCompensation(input: {
    tenantId?: string;
    tenant_id?: string;
    feedbackId?: string | null;
    feedback_id?: string | null;
    code?: string;
    promo_code?: string;
    promoCode?: string;
    referral_code?: string;
    referralCode?: string;
    thankyou_code?: string;
    thankyouCode?: string;
    thank_you_code?: string;
    source?: string;
    type?: string;
    percent?: number;
    discount_percent?: number;
    discount_amount?: number;
    percentOff?: number;
    percent_off?: number;
    validDays?: number;
    valid_days?: number;
    email?: string | null;
    customerEmail?: string | null;
    customer_email?: string | null;
    expires_at?: string | null;
    expiresAt?: string | null;
  }): Promise<IssuedCode> {
    const rawWanted =
      input.code ||
      input.promo_code ||
      input.promoCode ||
      input.referral_code ||
      input.referralCode ||
      input.thankyou_code ||
      input.thankyouCode ||
      input.thank_you_code;
    const wanted = rawWanted ? normalizeCode(rawWanted) : null;
    if (wanted && !CODE_FORMAT.test(wanted)) {
      throw new BadRequestException('Code must be 3–32 characters: letters, digits, "-" or "_".');
    }

    const isThankYou = wanted ? /^(THANK|REF)/i.test(wanted) : false;
    const defaultTerms = isThankYou ? this.referralTerms() : this.compensationTerms();

    let resolvedPercent =
      input.percent ??
      input.discount_percent ??
      input.discount_amount ??
      input.percentOff ??
      input.percent_off;

    if (resolvedPercent === undefined) {
      if (wanted) {
        const match = wanted.match(/^(?:SORRY|THANKYOU|REF)(\d{1,2})-/i);
        resolvedPercent = match ? parseInt(match[1], 10) : defaultTerms.percent;
      } else {
        resolvedPercent = defaultTerms.percent;
      }
    }

    const days = input.validDays ?? input.valid_days ?? defaultTerms.days;
    const db = this.supabase.admin;
    const source = input.source ?? (isThankYou ? 'referral' : 'compensation');

    const feedbackId = input.feedbackId ?? input.feedback_id ?? null;
    let tenantId = input.tenantId ?? input.tenant_id ?? null;
    const email = input.email ?? input.customerEmail ?? input.customer_email ?? null;

    // Resolve tenantId if missing
    if (!tenantId && feedbackId) {
      const { data: fb } = await db
        .from('feedback')
        .select('tenant_id')
        .eq('id', feedbackId)
        .maybeSingle<{ tenant_id: string }>();
      if (fb?.tenant_id) {
        tenantId = fb.tenant_id;
      }
    }
    if (!tenantId) {
      tenantId = defaultTerms.defaultTenantId;
    }

    if (feedbackId) {
      const { data: existing } = await db
        .from('promo_codes')
        .select('code, discount_percentage, expires_at')
        .eq('feedback_id', feedbackId)
        .maybeSingle<IssuedCode>();
      if (existing) {
        console.log(
          `[Promo Issue] Code "${existing.code}" already exists for feedback ${feedbackId}; reusing it.`,
        );
        this.logger.log(
          `Promo code ${existing.code} already exists for feedback ${feedbackId}; reusing it.`,
        );
        return existing;
      }
    }

    const expiresAt =
      input.expires_at ||
      input.expiresAt ||
      new Date(Date.now() + days * 86_400_000).toISOString();

    // A generated code can collide (rarely); retry with a fresh suffix.
    for (let attempt = 0; attempt < 5; attempt++) {
      const defaultPrefix = isThankYou ? 'THANKYOU10' : `SORRY${resolvedPercent}`;
      const code = wanted ?? `${defaultPrefix}-${randomSuffix(5)}`;
      const { data, error } = await db
        .from('promo_codes')
        .insert({
          tenant_id: tenantId,
          code,
          discount_percentage: resolvedPercent,
          is_used: false,
          source,
          feedback_id: feedbackId,
          issued_to_email: email?.trim() || null,
          expires_at: expiresAt,
        })
        .select('code, discount_percentage, expires_at')
        .single<IssuedCode>();

      if (!error && data) {
        console.log(
          `[Promo Issue] Successfully persisted ${source} code "${data.code}" (${resolvedPercent}% off, tenant: ${tenantId}, expires: ${expiresAt})`,
        );
        this.logger.log(
          `Issued ${source} code ${data.code} (${resolvedPercent}% off, expires ${expiresAt})${feedbackId ? ` for feedback ${feedbackId}` : ''}.`,
        );

        // Update feedback discount_code column if feedbackId exists
        if (feedbackId) {
          await db
            .from('feedback')
            .update({ discount_code: data.code, escalation_status: 'resolved' })
            .eq('id', feedbackId);
        }

        return data;
      }
      if (error && error.code !== '23505') {
        this.logger.error(`Failed to insert promo code: ${error.message}`);
        throw new BadRequestException(error.message);
      }
      if (wanted) {
        // If wanted code already existed for this tenant, reuse it
        const { data: existing } = await db
          .from('promo_codes')
          .select('code, discount_percentage, expires_at')
          .eq('tenant_id', tenantId)
          .eq('code', wanted)
          .maybeSingle<IssuedCode>();
        if (existing) {
          console.log(`[Promo Issue] Reusing existing code "${wanted}" for tenant ${tenantId}`);
          return existing;
        }
        throw new ConflictException(`Code ${wanted} already exists.`);
      }
    }
    throw new ConflictException('Could not generate a unique code; try again.');
  }

  /**
   * Pre-checkout check. No side effects — the code is only marked used when
   * the order is placed. Logs the precise reason; tells the guest only what
   * they can act on.
   */
  async validate(tenantId: string, rawCode: string) {
    const code = normalizeCode(rawCode ?? '');

    const refuse = (reason: string, message = 'That promo code is invalid or has already been used.') => {
      console.log(`[Promo Validation] Failed: ${reason} (code: "${code}", tenant: "${tenantId}")`);
      this.logger.warn(`Promo "${code}" refused for tenant ${tenantId}: ${reason}`);
      throw new BadRequestException(message);
    };

    if (!CODE_FORMAT.test(code)) {
      return refuse('Malformed code');
    }

    // Case-insensitive lookup using ilike
    const escapedCode = code.replace(/_/g, '\\_');
    const { data: rows, error } = await this.supabase.admin
      .from('promo_codes')
      .select('code, tenant_id, discount_percentage, is_used, used_at, expires_at, source, feedback_id')
      .ilike('code', escapedCode);

    if (error) {
      this.logger.error(`Promo lookup failed for "${code}": ${error.message}`);
      throw new BadRequestException("Couldn't check that code right now. Please try again.");
    }

    // If not found in promo_codes, check whether it is a dynamic apology or thank-you code
    // generated via the n8n feedback workflow (e.g. SORRY20-DQNA8, THANKYOU10-GWBWK).
    if (!rows || rows.length === 0) {
      const dynamicMatch = code.match(/^(SORRY|THANKYOU|THANK-YOU|THANKS|REFERRAL|REF)(?:(\d{1,2}))?-[A-Z0-9]{3,16}$/i);
      if (dynamicMatch) {
        const prefix = dynamicMatch[1].toUpperCase();
        const isThankYou = prefix.startsWith('THANK') || prefix.startsWith('REF');
        const percent = dynamicMatch[2]
          ? parseInt(dynamicMatch[2], 10)
          : isThankYou
            ? 10
            : 20;
        const source = isThankYou ? 'referral' : 'compensation';
        const targetTenant = tenantId || this.compensationTerms().defaultTenantId;
        const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

        try {
          const { data: inserted, error: insertErr } = await this.supabase.admin
            .from('promo_codes')
            .insert({
              tenant_id: targetTenant,
              code,
              discount_percentage: percent,
              is_used: false,
              source,
              expires_at: expiresAt,
            })
            .select('code, tenant_id, discount_percentage, is_used, used_at, expires_at, source, feedback_id')
            .single<PromoRow>();

          if (!insertErr && inserted) {
            console.log(
              `[Promo Validation] Dynamic ${source} code "${code}" recognized and persisted to DB for tenant ${targetTenant} (${percent}% off, expires ${expiresAt})`,
            );
            this.logger.log(`Dynamic ${source} code "${code}" persisted to promo_codes.`);
            return {
              code,
              percent: inserted.discount_percentage,
              discount_percent: inserted.discount_percentage,
              discount_amount: inserted.discount_percentage,
              expires_at: inserted.expires_at,
            };
          }
        } catch (dynErr) {
          this.logger.warn(`Could not auto-persist code "${code}": ${String(dynErr)}`);
        }
      }

      this.logger.warn(`${code} not found in promo_codes table for tenant ${tenantId}`);
      return refuse(`Code not found in DB (${code} not found in promo_codes table for tenant ${tenantId})`);
    }

    const row = (rows as PromoRow[]).find((r) => !tenantId || r.tenant_id === tenantId);
    if (!row) {
      this.logger.warn(`${code} not found in promo_codes table for tenant ${tenantId} (tenant mismatch)`);
      return refuse(`Tenant mismatch (${code} not found in promo_codes table for tenant ${tenantId})`);
    }

    if (row.is_used) {
      return refuse('Already used');
    }

    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      return refuse('Expired', 'That promo code has expired.');
    }

    console.log(
      `[Promo Validation] Success: Promo "${code}" valid (${row.discount_percentage}% off, tenant: ${row.tenant_id}, source: ${row.source})`,
    );
    this.logger.log(`Promo "${code}" valid: ${row.discount_percentage}% off (${row.source}).`);
    return {
      code,
      percent: row.discount_percentage,
      discount_percent: row.discount_percentage,
      discount_amount: row.discount_percentage,
      expires_at: row.expires_at,
    };
  }
}

function randomSuffix(length: number) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
