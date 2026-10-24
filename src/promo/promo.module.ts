import { Global, Module } from '@nestjs/common';
import { GlobalPromoController, PromoController, PromoWebhookController } from './promo.controller';
import { PromoService } from './promo.service';

@Global()
@Module({
  controllers: [PromoController, GlobalPromoController, PromoWebhookController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromoModule {}
