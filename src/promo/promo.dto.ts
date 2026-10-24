import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ValidatePromoDto {
  @IsString()
  @MaxLength(64)
  code: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}

/** n8n → API: save (or have the API generate) an apology code.
 * Accepts camelCase and snake_case attributes sent by n8n workflows.
 */
export class IssueCompensationDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsUUID()
  tenant_id?: string;

  /** Links the code to the review, making retries idempotent. */
  @IsOptional()
  @IsUUID()
  feedbackId?: string;

  @IsOptional()
  @IsUUID()
  feedback_id?: string;

  /** Omit to let the API generate SORRY<percent>-XXXXX. Case and hyphens are normalized. */
  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  promo_code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  promoCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  referral_code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  referralCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  thankyou_code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  thankyouCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  thank_you_code?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  percent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  discount_percent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  discount_amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  percentOff?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  percent_off?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  validDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  valid_days?: number;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsEmail()
  customer_email?: string;

  @IsOptional()
  @IsString()
  expires_at?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  is_used?: boolean;

  @IsOptional()
  @IsBoolean()
  isUsed?: boolean;
}
