import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../auth/roles';
import { unwrap } from '../common/supabase-result';
import { N8nService } from '../n8n/n8n.service';
import { PromoService } from '../promo/promo.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  CreateFeedbackDto,
  SentimentResultDto,
  UpdateEscalationDto,
} from './feedback.dto';

const COLUMNS =
  'id, tenant_id, order_id, customer_id, rating, text, source, sentiment, sentiment_score, ai_summary, escalation_status, discount_code, created_at';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly realtime: RealtimeGateway,
    private readonly n8n: N8nService,
    private readonly promo: PromoService,
  ) {}

  async create(user: AuthUser, tenantId: string, dto: CreateFeedbackDto) {
    // Load through the caller's Supabase client, so RLS proves this is the
    // customer's own completed order before a review can exist.
    const order = unwrap(
      await this.supabase
        .forUser(user)
        .from('orders')
        .select('id, status, tracking_code, total_cents, order_items ( name, quantity, unit_price_cents )')
        .eq('tenant_id', tenantId)
        .eq('id', dto.orderId)
        .single<{
          id: string;
          status: string;
          tracking_code: string | null;
          total_cents: number;
          order_items: { name: string; quantity: number; unit_price_cents: number }[];
        }>(),
    );
    if (order.status !== 'completed') {
      throw new BadRequestException(
        'Reviews are available after the order is completed',
      );
    }
    const row = unwrap(
      await this.supabase
        .forUser(user)
        .from('feedback')
        .insert({
          tenant_id: tenantId,
          order_id: dto.orderId,
          customer_id: user.id,
          rating: dto.rating,
          text: dto.text,
          source: dto.source,
        })
        .select(COLUMNS)
        .single<{ id: string; created_at: string }>(),
    );
    const { data: profile } = await this.supabase
      .forUser(user)
      .from('profiles')
      .select('display_name, phone, email')
      .eq('id', user.id)
      .maybeSingle<{ display_name: string | null; phone: string | null; email?: string | null }>();

    // Strictly resolve real customer email from auth, profile, or user-supplied input
    const realEmail =
      user.email?.trim() ||
      profile?.email?.trim() ||
      dto.customerEmail?.trim() ||
      '';

    const customerName =
      dto.customerName?.trim() ||
      profile?.display_name?.trim() ||
      (realEmail ? realEmail.split('@')[0] : 'Customer');

    // Don't block the customer on sentiment, voucher and notification work.
    void this.notifyWorkflow(tenantId, row.id, realEmail, dto.rating, {
      feedback_id: row.id,
      order_id: dto.orderId,
      tracking_id: order.tracking_code ?? dto.orderId,
      customer_name: customerName,
      customer_email: realEmail,
      customer_phone: profile?.phone?.trim() || '',
      rating: dto.rating,
      rating_stars: dto.rating,
      comment: dto.text,
      feedback_text: dto.text,
      source: dto.source,
      items: order.order_items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit_price: i.unit_price_cents / 100,
      })),
      items_ordered: order.order_items.map((i) => i.name),
      total_amount: order.total_cents / 100,
      currency: 'PKR',
      timestamp: row.created_at ?? new Date().toISOString(),
    });
    if (!realEmail) {
      // n8n can't email a customer without an address; make that visible.
      this.logger.warn(`Feedback ${row.id} has no customer email; n8n will not be able to reply.`);
    }
    return row;
  }

  /**
   * Low ratings get a saved, single-use apology code *before* n8n hears about
   * the review, so the code in the email always works at checkout. The
   * workflow should email `compensation_code` rather than invent its own.
   */
  private async notifyWorkflow(
    tenantId: string,
    feedbackId: string,
    email: string,
    rating: number,
    payload: Record<string, unknown>,
  ) {
    let promoData: Record<string, unknown> = {
      compensation_code: null,
      referral_code: null,
      thankyou_code: null,
    };

    if (rating <= this.promo.compensationTerms().maxRating) {
      // 1-star and 2-star reviews: issue 20% apology code (SORRY20-*)
      try {
        const issued = await this.promo.issueCompensation({ tenantId, feedbackId, email, percent: 20 });
        promoData = {
          compensation_code: issued.code,
          compensation_percent: issued.discount_percentage,
          compensation_expires_at: issued.expires_at,
          promo_code: issued.code,
          discount_code: issued.code,
          coupon_code: issued.code,
          voucher_code: issued.code,
          code: issued.code,
          discount_percent: issued.discount_percentage,
          discount_amount: issued.discount_percentage,
          expires_at: issued.expires_at,
          tenant_id: tenantId,
          tenantId: tenantId,
          is_used: false,
        };
      } catch (err) {
        this.logger.error(`Could not issue a compensation code for feedback ${feedbackId}: ${String(err)}`);
      }
    } else if (rating >= 4) {
      // 4-star and 5-star reviews: issue 10% thank-you/referral code (THANKYOU10-*)
      try {
        const issued = await this.promo.issueReferral({ tenantId, feedbackId, email, percent: 10 });
        promoData = {
          referral_code: issued.code,
          referralCode: issued.code,
          thankyou_code: issued.code,
          thankyouCode: issued.code,
          thank_you_code: issued.code,
          compensation_code: issued.code,
          compensation_percent: issued.discount_percentage,
          compensation_expires_at: issued.expires_at,
          promo_code: issued.code,
          discount_code: issued.code,
          coupon_code: issued.code,
          voucher_code: issued.code,
          code: issued.code,
          discount_percent: issued.discount_percentage,
          discount_amount: issued.discount_percentage,
          expires_at: issued.expires_at,
          tenant_id: tenantId,
          tenantId: tenantId,
          is_used: false,
        };
      } catch (err) {
        this.logger.error(`Could not issue a referral code for feedback ${feedbackId}: ${String(err)}`);
      }
    }

    this.n8n.dispatch('feedback', 'feedback.submitted', { ...payload, ...promoData });
  }

  /** n8n callback. Runs with the service role — the caller is a machine. */
  async applySentiment(dto: SentimentResultDto) {
    const row = unwrap(
      await this.supabase.admin
        .from('feedback')
        .update({
          sentiment: dto.sentiment,
          sentiment_score: dto.score,
          ai_summary: dto.summary ?? null,
          escalation_status: dto.sentiment === 'negative' ? 'open' : null,
        })
        .eq('id', dto.feedbackId)
        .select(COLUMNS)
        .single<{ tenant_id: string; sentiment: string }>(),
    );
    if (row.sentiment === 'negative') {
      this.realtime.emitFeedbackFlagged(row.tenant_id, row);
    } else if (row.sentiment === 'positive') {
      // Ensure positive feedback review has a persisted 10% thank-you referral code
      try {
        await this.promo.issueReferral({ tenantId: row.tenant_id, feedbackId: dto.feedbackId, percent: 10 });
      } catch (err) {
        this.logger.warn(`Could not ensure referral code for positive feedback ${dto.feedbackId}: ${String(err)}`);
      }
    }
    return { ok: true };
  }

  async escalationQueue(user: AuthUser, tenantId: string) {
    return unwrap(
      await this.supabase
        .forUser(user)
        .from('feedback')
        .select(COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('sentiment', 'negative')
        .neq('escalation_status', 'resolved')
        .order('created_at', { ascending: false }),
    );
  }

  async setEscalation(
    user: AuthUser,
    tenantId: string,
    id: string,
    dto: UpdateEscalationDto,
  ) {
    return unwrap(
      await this.supabase
        .forUser(user)
        .from('feedback')
        .update({ escalation_status: dto.status })
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .select(COLUMNS)
        .single(),
    );
  }

  /** Creates a single-use apology code tied to the unhappy customer and stored in promo_codes. */
  async issueDiscount(
    user: AuthUser,
    tenantId: string,
    id: string,
    percentOff: number,
  ) {
    const db = this.supabase.forUser(user);
    const fb = unwrap(
      await db
        .from('feedback')
        .select('customer_id')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single<{ customer_id: string }>(),
    );
    let email: string | undefined;
    if (fb.customer_id) {
      try {
        const { data: authUser } = await this.supabase.admin.auth.admin.getUserById(fb.customer_id);
        email = authUser?.user?.email;
      } catch {
        // ignore email resolution error
      }
    }

    const issued = await this.promo.issueCompensation({
      tenantId,
      feedbackId: id,
      percent: percentOff,
      email,
    });

    // Backwards-compatibility for discount_codes table
    try {
      await db
        .from('discount_codes')
        .insert({
          tenant_id: tenantId,
          code: issued.code,
          percent_off: percentOff,
          customer_id: fb.customer_id,
          feedback_id: id,
          issued_by: user.id,
        });
    } catch {
      // ignore if discount_codes table omitted
    }

    return unwrap(
      await db
        .from('feedback')
        .update({ discount_code: issued.code, escalation_status: 'resolved' })
        .eq('id', id)
        .select(COLUMNS)
        .single(),
    );
  }
}

