import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFeedbackDto {
  @IsUUID()
  orderId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MaxLength(2000)
  text: string;

  @IsIn(['text', 'voice'])
  source: 'text' | 'voice';

  @IsOptional()
  @IsString()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  customerName?: string;
}

/** Payload n8n posts back after scoring sentiment. */
export class SentimentResultDto {
  @IsUUID()
  feedbackId: string;

  @IsIn(['positive', 'neutral', 'negative'])
  sentiment: 'positive' | 'neutral' | 'negative';

  @IsNumber()
  @Min(-1)
  @Max(1)
  score: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;
}

export class UpdateEscalationDto {
  @IsIn(['open', 'escalated', 'resolved'])
  status: 'open' | 'escalated' | 'resolved';
}

export class IssueDiscountDto {
  @IsInt()
  @Min(5)
  @Max(100)
  percentOff: number;
}
