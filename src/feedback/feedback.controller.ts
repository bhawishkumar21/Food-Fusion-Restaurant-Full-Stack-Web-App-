import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { Role } from '../auth/roles';
import type { AuthUser } from '../auth/roles';
import { WebhookSecretGuard } from '../auth/webhook.guard';
import {
  CreateFeedbackDto,
  IssueDiscountDto,
  SentimentResultDto,
  UpdateEscalationDto,
} from './feedback.dto';
import { FeedbackService } from './feedback.service';

@Controller('t/:tenantId/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.feedback.create(user, tenantId, dto);
  }

  @Roles(Role.SuperAdmin)
  @Get('escalations')
  queue(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.feedback.escalationQueue(user, tenantId);
  }

  @Roles(Role.SuperAdmin)
  @Patch(':id/escalation')
  escalate(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEscalationDto,
  ) {
    return this.feedback.setEscalation(user, tenantId, id, dto);
  }

  @Roles(Role.SuperAdmin)
  @Post(':id/discount')
  discount(
    @CurrentUser() user: AuthUser,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueDiscountDto,
  ) {
    return this.feedback.issueDiscount(user, tenantId, id, dto.percentOff);
  }
}

@Controller('webhooks/n8n')
export class N8nWebhookController {
  constructor(private readonly feedback: FeedbackService) {}

  @Public()
  @UseGuards(WebhookSecretGuard)
  @Post('sentiment')
  sentiment(@Body() dto: SentimentResultDto) {
    return this.feedback.applySentiment(dto);
  }
}
