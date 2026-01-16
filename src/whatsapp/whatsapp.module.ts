import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { KnowledgeModule } from '../knowledge/knowledge.module'; // <--- Import logic
import { STUDENT_PORT, CONVERSATION_PORT, WHATSAPP_PROVIDER } from './ports';
import { StudentAdapter } from '../student/student.adapter';
import { ConversationAdapter } from '../conversation/conversation.adapter';
import { WhatsappProviderAdapter } from './adapters/whatsapp-provider.adapter';
import { Student } from '../student/entities/student.entity';
import { Conversation } from '../conversation/entities/conversation.entity';

/**
 * WhatsappModule - Arquitectura Hexagonal
 *
 * Este módulo configura la inyección de dependencias siguiendo el patrón
 * de puertos y adaptadores:
 *
 * - Los PUERTOS (interfaces) definen contratos en `./ports/`
 * - Los ADAPTADORES (implementaciones) viven en cada módulo de infraestructura
 * - El SERVICIO (dominio) solo conoce los puertos, no los adaptadores
 *
 * Beneficios:
 * - Fácil testing: podemos inyectar mocks de los puertos
 * - Desacoplamiento: cambiar de ORM solo requiere nuevos adaptadores
 * - Tipado seguro: sin dependencias circulares ni `any`
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule,
    KnowledgeModule, // <--- Add module
    // TypeORM para los adaptadores
    TypeOrmModule.forFeature([Student, Conversation]),
  ],
  controllers: [WhatsappController],
  providers: [
    WhatsappService,
    // Inyección de Puertos -> Adaptadores
    {
      provide: STUDENT_PORT,
      useClass: StudentAdapter,
    },
    {
      provide: CONVERSATION_PORT,
      useClass: ConversationAdapter,
    },
    {
      provide: WHATSAPP_PROVIDER,
      useClass: WhatsappProviderAdapter,
    },
  ],
})
export class WhatsappModule {}
