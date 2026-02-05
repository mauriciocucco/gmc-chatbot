import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StudentModule } from './student/student.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Cache en memoria para embeddings de queries frecuentes
    CacheModule.register({
      isGlobal: true,
      ttl: 3600 * 1000, // 1 hora por defecto
      max: 500, // Máximo 500 entradas en cache
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false, // Corre migraciones pendientes al iniciar la app
        ssl:
          configService.get<string>('DB_SSL') === 'true'
            ? {
                rejectUnauthorized:
                  configService.get<string>('NODE_ENV') === 'production',
              }
            : false,
        // -------------------
      }),
    }),
    WhatsappModule,
    StudentModule,
    KnowledgeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
