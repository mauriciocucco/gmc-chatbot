import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Importante para verificar firma de Webhooks
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
