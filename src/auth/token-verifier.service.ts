import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { AuthUser, resolveRole } from './roles';

interface SupabaseClaims extends JWTPayload {
  email?: string;
  app_metadata?: { role?: string; tenant_id?: string };
}

/**
 * Verifies Supabase access tokens. Prefers the project's asymmetric JWKS
 * (Supabase signing keys); falls back to the legacy HS256 secret if set.
 * Shared by the HTTP guard and the Socket.io gateway.
 */
@Injectable()
export class TokenVerifier {
  private readonly jwks?: JWTVerifyGetKey;
  private readonly secret?: Uint8Array;
  private readonly issuer: string;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('SUPABASE_URL');
    this.issuer = `${url}/auth/v1`;
    const legacySecret = config.get<string>('SUPABASE_JWT_SECRET');
    if (legacySecret) this.secret = new TextEncoder().encode(legacySecret);
    else
      this.jwks = createRemoteJWKSet(
        new URL(`${this.issuer}/.well-known/jwks.json`),
      );
  }

  async verify(token: string): Promise<AuthUser> {
    try {
      const options = { issuer: this.issuer, audience: 'authenticated' };
      const { payload } = this.secret
        ? await jwtVerify<SupabaseClaims>(token, this.secret, options)
        : await jwtVerify<SupabaseClaims>(token, this.jwks!, options);

      // The hardcoded super-admin email wins; Supabase only puts verified
      // emails in the token (Google OAuth / email OTP).
      const role = resolveRole(payload.email, payload.app_metadata?.role);
      return {
        id: payload.sub!,
        email: payload.email,
        role,
        // Super admins may carry a home tenant but are never confined to it.
        tenantId: payload.app_metadata?.tenant_id ?? null,
        accessToken: token,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}
