import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

type CorsCallback = (err: Error | null, allow?: boolean) => void;

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const isProduction = process.env.NODE_ENV === 'production';
/** Comma-separated list, e.g. "https://foodfusion.pk,https://www.foodfusion.pk". */
const allowedOrigins = (process.env.WEB_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (origin: string | undefined, callback: CorsCallback) => {
      // No Origin header: mobile apps, curl, server-to-server.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Any local dev port (3000, 3001, …) outside production.
      if (!isProduction && LOCALHOST.test(origin)) return callback(null, true);
      // Credentials are allowed, so unknown origins must be refused, not echoed.
      logger.warn(`CORS blocked origin ${origin}`);
      return callback(null, false);
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}/api`);
  logger.log(`CORS origins: ${[...allowedOrigins, ...(isProduction ? [] : ['localhost:*'])].join(', ') || 'none'}`);
}

void bootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').error('Failed to start', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
