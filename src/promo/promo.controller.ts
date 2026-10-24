import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { WebhookSecretGuard } from '../auth/webhook.guard';
import { IssueCompensationDto, ValidatePromoDto } from './promo.dto';
import { PromoService } from './promo.service';

@Controller(['t/:tenantId/promo-codes', 't/:tenantId/coupons'])
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  /** Guests check a code in the cart before checkout (nothing is consumed). */
  @Public()
  @HttpCode(200)
  @Post(['validate', 'check'])
  validate(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: ValidatePromoDto,
  ) {
    return this.promo.validate(tenantId, dto.code);
  }

  @Public()
  @UseGuards(WebhookSecretGuard)
  @Post(['referral', 'compensation', 'issue'])
  issue(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: IssueCompensationDto,
  ) {
    return this.promo.issueCompensation({ ...dto, tenantId });
  }
}

@Controller(['promo-codes', 'coupons', 'promo'])
export class GlobalPromoController {
  constructor(private readonly promo: PromoService) {}

  @Public()
  @HttpCode(200)
  @Post(['validate', 'check'])
  validate(@Body() dto: ValidatePromoDto) {
    const tenantId = dto.tenantId || dto.tenant_id || '';
    return this.promo.validate(tenantId, dto.code);
  }
}

@Controller(['webhooks/n8n', 'webhooks'])
export class PromoWebhookController {
  constructor(private readonly promo: PromoService) {}

  /**
   * The feedback workflow saves apology or referral codes here before or after emailing them,
   * so the code in the email always works at checkout.
   */
  @Public()
  @UseGuards(WebhookSecretGuard)
  @Post([
    'compensation-codes',
    'promo-codes',
    'coupons',
    'compensation',
    'discount-codes',
    'referral-codes',
    'referral',
    'thankyou-codes',
    'thankyou',
  ])
  issue(@Body() dto: IssueCompensationDto) {
    return this.promo.issueCompensation(dto);
  }
}
