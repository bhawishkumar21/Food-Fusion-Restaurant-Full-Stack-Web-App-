import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { TokenVerifier } from './token-verifier.service';

@Global()
@Module({
  providers: [
    TokenVerifier,
    // Order matters: authenticate first, then authorise.
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenVerifier],
})
export class AuthModule {}
