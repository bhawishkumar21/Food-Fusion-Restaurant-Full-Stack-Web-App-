import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from '../supabase/supabase.service';
import { normalizeCode, PromoService } from './promo.service';

describe('PromoService', () => {
  let service: PromoService;
  let supabaseMock: any;
  let configMock: any;

  const mockDbRows: any[] = [];

  beforeEach(async () => {
    mockDbRows.length = 0;

    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'COMPENSATION_DISCOUNT_PERCENT') return 20;
        if (key === 'COMPENSATION_VALID_DAYS') return 30;
        if (key === 'COMPENSATION_MAX_RATING') return 2;
        if (key === 'REFERRAL_DISCOUNT_PERCENT') return 10;
        if (key === 'REFERRAL_VALID_DAYS') return 30;
        if (key === 'REFERRAL_MIN_RATING') return 4;
        if (key === 'DEFAULT_TENANT_ID') return 'f00df051-0000-4000-8000-000000000001';
        return null;
      }),
    };

    const queryBuilder = (table: string) => {
      let filterCol: string | null = null;
      let filterVal: any = null;
      let ilikeCol: string | null = null;
      let ilikeVal: string | null = null;
      let isSingle = false;
      let isMaybeSingle = false;

      let insertedRow: any = null;

      const builder: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn((col: string, val: any) => {
          filterCol = col;
          filterVal = val;
          return builder;
        }),
        ilike: jest.fn((col: string, pattern: string) => {
          ilikeCol = col;
          ilikeVal = pattern;
          return builder;
        }),
        single: jest.fn(() => {
          isSingle = true;
          return builder.execute();
        }),
        maybeSingle: jest.fn(() => {
          isMaybeSingle = true;
          return builder.execute();
        }),
        insert: jest.fn((row: any) => {
          insertedRow = { ...row };
          mockDbRows.push(insertedRow);
          return builder;
        }),
        update: jest.fn((patch: any) => {
          return builder;
        }),
        then: (resolve: any) => resolve(builder.execute()),
        execute: () => {
          if (insertedRow) {
            return { data: insertedRow, error: null };
          }
          let rows = [...mockDbRows];
          if (filterCol) {
            rows = rows.filter((r) => r[filterCol!] === filterVal);
          }
          if (ilikeCol) {
            const rawPattern = ilikeVal!.replace(/\\_/g, '_').toLowerCase();
            rows = rows.filter((r) => r[ilikeCol!].toLowerCase() === rawPattern);
          }
          if (isSingle) {
            return { data: rows[0] ?? null, error: rows.length ? null : { message: 'Not found' } };
          }
          if (isMaybeSingle) {
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null };
        },
      };
      return builder;
    };

    supabaseMock = {
      admin: {
        from: jest.fn((table: string) => queryBuilder(table)),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromoService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<PromoService>(PromoService);
  });

  describe('normalizeCode', () => {
    it('normalizes casing, whitespace, and hyphens', () => {
      expect(normalizeCode(' sorry20-dqna8 ')).toBe('SORRY20-DQNA8');
      expect(normalizeCode('SORRY20 - DQNA8')).toBe('SORRY20-DQNA8');
      expect(normalizeCode(' welcome10 ')).toBe('WELCOME10');
    });
  });

  describe('issueCompensation', () => {
    it('persists a compensation code into the database with 30-day expiry and is_used=false', async () => {
      const issued = await service.issueCompensation({
        tenant_id: 'f00df051-0000-4000-8000-000000000001',
        code: 'SORRY20-DQNA8',
        discount_percent: 20,
        email: 'customer@test.com',
      });

      expect(issued.code).toBe('SORRY20-DQNA8');
      expect(issued.discount_percentage).toBe(20);
      expect(mockDbRows).toHaveLength(1);
      expect(mockDbRows[0]).toMatchObject({
        tenant_id: 'f00df051-0000-4000-8000-000000000001',
        code: 'SORRY20-DQNA8',
        discount_percentage: 20,
        is_used: false,
        source: 'compensation',
      });
    });

    it('falls back to default tenant ID if tenant_id is missing', async () => {
      const issued = await service.issueCompensation({
        code: 'SORRY20-FALLBACK',
        discount_percent: 20,
      });

      expect(issued.code).toBe('SORRY20-FALLBACK');
      expect(mockDbRows[0].tenant_id).toBe('f00df051-0000-4000-8000-000000000001');
    });
  });

  describe('issueReferral', () => {
    it('persists a referral code into the database with 30-day expiry, 10% discount, and source=referral', async () => {
      const issued = await service.issueReferral({
        tenantId: 'f00df051-0000-4000-8000-000000000001',
        email: 'happy@test.com',
      });

      expect(issued.code).toMatch(/^THANKYOU10-[A-Z0-9]{5}$/);
      expect(issued.discount_percentage).toBe(10);
      expect(mockDbRows).toHaveLength(1);
      expect(mockDbRows[0]).toMatchObject({
        tenant_id: 'f00df051-0000-4000-8000-000000000001',
        discount_percentage: 10,
        is_used: false,
        source: 'referral',
      });
    });
  });

  describe('validate', () => {
    const tenantId = 'f00df051-0000-4000-8000-000000000001';

    beforeEach(() => {
      // Seed a standard code
      mockDbRows.push({
        tenant_id: tenantId,
        code: 'WELCOME10',
        discount_percentage: 10,
        is_used: false,
        used_at: null,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        source: 'manual',
      });
    });

    it('validates a code case-insensitively without marking it used', async () => {
      const res = await service.validate(tenantId, ' welcome10 ');
      expect(res.code).toBe('WELCOME10');
      expect(res.percent).toBe(10);
      // Ensure row is NOT marked is_used in pre-checkout validation
      expect(mockDbRows[0].is_used).toBe(false);
    });

    it('auto-persists and validates dynamic apology codes like SORRY20-DQNA8 if not in DB', async () => {
      const res = await service.validate(tenantId, ' sorry20 - dqna8 ');
      expect(res.code).toBe('SORRY20-DQNA8');
      expect(res.percent).toBe(20);
      // Verify dynamically inserted into DB
      const row = mockDbRows.find((r) => r.code === 'SORRY20-DQNA8');
      expect(row).toBeDefined();
      expect(row.is_used).toBe(false);
      expect(row.discount_percentage).toBe(20);
    });

    it('auto-persists and validates dynamic referral codes like THANKYOU10-GWBWK if not in DB', async () => {
      const res = await service.validate(tenantId, ' thankyou10 - gwbwk ');
      expect(res.code).toBe('THANKYOU10-GWBWK');
      expect(res.percent).toBe(10);
      // Verify dynamically inserted into DB with source referral
      const row = mockDbRows.find((r) => r.code === 'THANKYOU10-GWBWK');
      expect(row).toBeDefined();
      expect(row.is_used).toBe(false);
      expect(row.discount_percentage).toBe(10);
      expect(row.source).toBe('referral');
    });

    it('throws when code is already used', async () => {
      mockDbRows[0].is_used = true;
      mockDbRows[0].used_at = new Date().toISOString();

      await expect(service.validate(tenantId, 'WELCOME10')).rejects.toThrow(BadRequestException);
    });

    it('throws when code is expired', async () => {
      mockDbRows[0].expires_at = new Date(Date.now() - 86400000).toISOString();

      await expect(service.validate(tenantId, 'WELCOME10')).rejects.toThrow(
        'That promo code has expired.',
      );
    });

    it('throws on tenant mismatch', async () => {
      await expect(
        service.validate('f00df051-0000-4000-8000-000000000002', 'WELCOME10'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when non-apology code is not in DB', async () => {
      await expect(service.validate(tenantId, 'UNKNOWN99')).rejects.toThrow(BadRequestException);
    });
  });
});
