/**
 * Roles. The stored role lives in Supabase `auth.users.raw_app_meta_data.role`
 * (writable only with the service role), with one hardcoded exception:
 *
 *  super_admin — ONLY the account whose (verified) email is SUPER_ADMIN_EMAIL.
 *                Never assignable; a stored "super_admin" on any other
 *                account is ignored.
 *  manager     — operations / HR (one restaurant): orders, kitchen, inventory,
 *                reservations
 *  staff       — kitchen staff (one restaurant): live order queue + 86 toggle
 *  user        — everyone else (default for every new sign-up)
 *
 * Mirrors public.jwt_role() / public.assign_app_role() in supabase/migrations.
 */
export enum Role {
  SuperAdmin = 'super_admin',
  Manager = 'manager',
  Staff = 'staff',
  User = 'user',
}

export const SUPER_ADMIN_EMAIL = 'bhawishk15@gmail.com';

/** Roles the super admin may hand out from /admin/users. */
export const ASSIGNABLE_ROLES = [Role.Manager, Role.Staff, Role.User] as const;

/** Each role implicitly holds the roles listed for it. */
const INHERITS: Record<Role, Role[]> = {
  [Role.SuperAdmin]: [Role.Manager, Role.Staff, Role.User],
  [Role.Manager]: [Role.Staff],
  [Role.Staff]: [],
  [Role.User]: [],
};

export function hasRole(actual: Role, required: Role): boolean {
  return actual === required || INHERITS[actual].includes(required);
}

/** Roles confined to one restaurant (must not cross tenants). */
export const TENANT_SCOPED_ROLES: ReadonlySet<Role> = new Set([
  Role.Manager,
  Role.Staff,
]);

export const isSuperAdminEmail = (email?: string | null) =>
  (email ?? '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;

/**
 * Effective role from a verified token: the hardcoded email wins; a stored
 * role is honoured only if it is assignable. Pre-RBAC names still in old
 * JWTs map onto the current tiers (`kitchen` was remapped to manager).
 */
export function resolveRole(
  email: string | null | undefined,
  stored: unknown,
): Role {
  if (isSuperAdminEmail(email)) return Role.SuperAdmin;
  switch (stored) {
    case Role.Manager:
    case 'kitchen':
      return Role.Manager;
    case Role.Staff:
      return Role.Staff;
    default:
      return Role.User; // incl. a forged/legacy "super_admin" or "owner"
  }
}

/** For values that aren't tied to a token (e.g. listing users). */
export const parseRole = (value: unknown) => resolveRole(null, value);

export interface AuthUser {
  id: string;
  email?: string;
  role: Role;
  /** Restaurant the account belongs to (required for managers & staff). */
  tenantId: string | null;
  /** Raw bearer token, forwarded to Supabase so RLS applies to every query. */
  accessToken: string;
}
