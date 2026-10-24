import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const MENU_TAGS = [
  'vegan',
  'high_protein',
  'chef_special',
  'quick_bite',
] as const;
export type MenuTag = (typeof MENU_TAGS)[number];

export class ToggleAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;

  /**
   * Portions left today (manager inventory). Each order decrements it and the
   * dish auto-86s at 0. Null = not tracked.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(9999)
  dailyStock?: number | null;
}

export class UpsertMenuItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsIn(MENU_TAGS, { each: true })
  tags?: MenuTag[];

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  /** Extra facts the voice agent may use (allergens, pairing, spice level). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  voiceNotes?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(9999)
  dailyStock?: number | null;
}
