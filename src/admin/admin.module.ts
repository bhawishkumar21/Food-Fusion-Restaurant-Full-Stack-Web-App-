import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminController } from './admin.controller';
import { UsersController } from './users.controller';
import { ApiUsageInterceptor } from './api-usage.interceptor';

@Module({
  controllers: [AdminController, UsersController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: ApiUsageInterceptor }],
})
export class AdminModule {}
