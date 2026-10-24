import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const ORDER_STATUSES = [
  'new',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Allowed KDS transitions. Anything else is rejected. */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  new: ['preparing', 'completed', 'cancelled'],
  preparing: ['ready', 'out_for_delivery', 'completed', 'cancelled'],
  ready: ['out_for_delivery', 'completed'],
  out_for_delivery: ['completed'],
  completed: [],
  cancelled: [],
};

class OrderLineDto {
  @IsUUID()
  menuItemId: string;

  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;
}

export class CreateOrderDto {
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items: OrderLineDto[];

  @IsIn(['pickup', 'delivery', 'dine_in'])
  fulfilment: 'pickup' | 'delivery' | 'dine_in';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  /** 'voice' when the cart was built by the AI assistant — feeds analytics. */
  @IsOptional()
  @IsIn(['web', 'voice'])
  channel?: 'web' | 'voice';

  /** Single-use promo code; redeemed inside place_order or the order is rejected. */
  @IsOptional()
  @IsString()
  @Matches(/^\s*[A-Za-z0-9_-\s]{3,36}\s*$/)
  promoCode?: string;
}

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES)
  status: OrderStatus;
}
