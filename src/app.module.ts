import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { Public } from './auth/decorators';
import { AuthModule } from './auth/auth.module';
import { FeedbackModule } from './feedback/feedback.module';
import { MenuModule } from './menu/menu.module';
import { N8nModule } from './n8n/n8n.module';
import { OrdersModule } from './orders/orders.module';
import { PromoModule } from './promo/promo.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SupabaseModule } from './supabase/supabase.module';
import { VoiceModule } from './voice/voice.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    N8nModule,
    PromoModule,
    AuthModule,
    RealtimeModule,
    MenuModule,
    OrdersModule,
    FeedbackModule,
    VoiceModule,
    AnalyticsModule,
    ReservationsModule,
    AdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
