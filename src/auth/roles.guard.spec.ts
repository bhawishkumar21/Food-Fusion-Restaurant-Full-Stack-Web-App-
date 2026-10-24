import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { AuthUser, resolveRole, Role, SUPER_ADMIN_EMAIL } from './roles';
import { RolesGuard } from './roles.guard';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function ctx(
  user: Partial<AuthUser>,
  meta: { roles?: Role[]; isPublic?: boolean },
  params: Record<string, string> = { tenantId: TENANT_A },
) {
  const handler = () => undefined;
  if (meta.roles) Reflect.defineMetadata(ROLES_KEY, meta.roles, handler);
  if (meta.isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user: { tenantId: TENANT_A, ...user }, params }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const allows = (role: Role, required: Role[], tenantId = TENANT_A) =>
    guard.canActivate(ctx({ role }, { roles: required }, { tenantId }));

  it('super admin passes every role check, on any restaurant', () => {
    for (const r of [Role.SuperAdmin, Role.Manager, Role.Staff, Role.User]) {
      expect(allows(Role.SuperAdmin, [r], TENANT_B)).toBe(true);
    }
  });

  it('managers inherit staff (kitchen) but not super admin', () => {
    expect(allows(Role.Manager, [Role.Staff])).toBe(true);
    expect(() => allows(Role.Manager, [Role.SuperAdmin])).toThrow(
      ForbiddenException,
    );
  });

  it('staff reach the kitchen queue only', () => {
    expect(allows(Role.Staff, [Role.Staff])).toBe(true);
    expect(() => allows(Role.Staff, [Role.Manager])).toThrow(
      ForbiddenException,
    );
  });

  it('users are kept out of staff routes', () => {
    expect(() => allows(Role.User, [Role.Staff])).toThrow(ForbiddenException);
  });

  it('managers and staff cannot cross restaurants', () => {
    expect(() => allows(Role.Manager, [Role.Manager], TENANT_B)).toThrow(
      'Cross-tenant access denied',
    );
    expect(() => allows(Role.Staff, [Role.Staff], TENANT_B)).toThrow(
      'Cross-tenant access denied',
    );
  });

  it('skips checks on @Public routes', () => {
    expect(guard.canActivate(ctx({}, { isPublic: true }))).toBe(true);
  });
});

describe('resolveRole (hardcoded super admin)', () => {
  it('grants super admin to the hardcoded email only, case-insensitively', () => {
    expect(resolveRole(SUPER_ADMIN_EMAIL, undefined)).toBe(Role.SuperAdmin);
    expect(resolveRole('  BhawishK15@Gmail.com ', 'user')).toBe(
      Role.SuperAdmin,
    );
  });

  it('ignores a stored "super_admin" on any other account', () => {
    expect(resolveRole('someone@else.com', 'super_admin')).toBe(Role.User);
    expect(resolveRole('someone@else.com', 'owner')).toBe(Role.User);
  });

  it('defaults new / unknown accounts to user and honours assigned roles', () => {
    expect(resolveRole('new@guest.com', undefined)).toBe(Role.User);
    expect(resolveRole('a@b.com', 'manager')).toBe(Role.Manager);
    expect(resolveRole('a@b.com', 'staff')).toBe(Role.Staff);
    expect(resolveRole('a@b.com', 'kitchen')).toBe(Role.Manager); // legacy
  });
});
