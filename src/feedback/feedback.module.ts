import { Module } from '@nestjs/common';
import {
  FeedbackController,
  N8nWebhookController,
} from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  controllers: [FeedbackController, N8nWebhookController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
