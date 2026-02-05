import {
  Injectable,
  ForbiddenException,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStep } from '../conversation/enums/conversation-step.enum';
import { KnowledgeService } from '../knowledge/knowledge.service';
import {
  extractFirstWhatsappMessage,
  extractWhatsappContactName,
} from './utils/whatsapp.utils';
import { CONVERSATION_PORT, STUDENT_PORT, WHATSAPP_PROVIDER } from './ports';
import type {
  ConversationPort,
  ConversationData,
} from './ports/conversation.port';
import type { StudentPort, StudentData } from './ports/student.port';
import type { WhatsappProviderPort } from './ports/whatsapp-provider.port';

/**
 * WhatsappService - Arquitectura Hexagonal
 *
 * Este servicio es el "núcleo" del dominio. Solo conoce puertos (interfaces),
 * no sabe nada de TypeORM, entidades ni bases de datos.
 *
 * Principios aplicados:
 * - Dependency Inversion: Depende de abstracciones (puertos), no de implementaciones
 * - Single Responsibility: Solo maneja la lógica del flujo de WhatsApp
 * - Clean Architecture: El dominio no depende de infraestructura
 */
@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);

  // Rate Limiting (Anti-Factura Exorbitante)
  // 30 preguntas cada 1 hora por alumno
  private readonly RATE_LIMIT_WINDOW = 60 * 60 * 1000;
  private readonly MAX_REQUESTS_PER_WINDOW = 30;
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // Limpieza cada 5 minutos
  private usageMap = new Map<string, { count: number; expiresAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly knowledgeService: KnowledgeService,
    @Inject(STUDENT_PORT)
    private readonly studentPort: StudentPort,
    @Inject(CONVERSATION_PORT)
    private readonly conversationPort: ConversationPort,
    @Inject(WHATSAPP_PROVIDER)
    private readonly whatsappProvider: WhatsappProviderPort,
  ) {}

  onModuleInit(): void {
    // Iniciar limpieza periódica de rate limits expirados
    this.cleanupTimer = setInterval(() => {
      this.cleanExpiredRateLimits();
    }, this.CLEANUP_INTERVAL);
    this.logger.log('🧹 Rate limit cleanup timer iniciado');
  }

  onModuleDestroy(): void {
    // Limpiar el timer al destruir el módulo
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.logger.log('🛑 Rate limit cleanup timer detenido');
    }
  }

  /**
   * Limpia entradas expiradas del mapa de rate limiting.
   * Previene memory leak al eliminar registros que ya no son necesarios.
   */
  private cleanExpiredRateLimits(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, record] of this.usageMap) {
      if (now > record.expiresAt) {
        this.usageMap.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(
        `🧹 Limpiadas ${cleaned} entradas de rate limit expiradas`,
      );
    }
  }

  verifyWebhook(mode: string, token: string, challenge: string): string {
    const verifyToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (!mode || !token) {
      throw new ForbiddenException('Faltan parámetros de verificación');
    }

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('✅ Webhook verificado correctamente.');
      return challenge;
    }

    throw new ForbiddenException('Token de verificación inválido');
  }

  async handleMessage(webhookData: unknown): Promise<void> {
    try {
      const messageData = extractFirstWhatsappMessage(webhookData);
      const contactName = extractWhatsappContactName(webhookData);

      if (!messageData || messageData.type !== 'text') {
        return;
      }

      const rawFrom = messageData.from;
      const from = this.cleanPhoneNumber(rawFrom);
      const textBody = messageData.text?.body?.trim() || '';
      // 1. ZONA ADMIN: Comandos
      const adminPhone = this.configService.get<string>('ADMIN_PHONE_NUMBER');

      if (from === adminPhone) {
        if (await this.handleAdminCommands(from, textBody)) {
          return;
        }
      }

      const student = await this.getOrCreateStudent(from, contactName || null);

      // 2. GATEKEEPER (Fecha de Vencimiento)
      if (from !== adminPhone) {
        const now = new Date();
        const expiresAt = student.accessExpiresAt
          ? new Date(student.accessExpiresAt)
          : null;

        if (!expiresAt || now > expiresAt) {
          await this.whatsappProvider.sendMessage(
            from,
            '⛔ *Acceso restringido.*\nTu permiso para usar el instructor virtual ha expirado o no está habilitado.\nPor favor, contactá a tu instructor para activarlo.',
          );
          return;
        }
      }

      if (textBody.toLowerCase() === 'reset') {
        await this.handleReset(student);
        return;
      }

      const conversation = await this.getOrCreateConversation(student);

      await this.processConversationStep(conversation, textBody);
    } catch (error) {
      const err = error as Error;

      this.logger.error(`Error handling message: ${err.message}`, err.stack);
    }
  }

  // --- ADMIN COMMANDS ---
  private async handleAdminCommands(
    adminPhone: string,
    text: string,
  ): Promise<boolean> {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();

    // Comando: Alta 1122334455 [dias]
    if (command === 'alta') {
      const rawTargetPhone = parts[1];

      if (!rawTargetPhone) {
        await this.whatsappProvider.sendMessage(
          adminPhone,
          '❌ Faltó el número.\nUso: Alta [telefono] [dias]',
        );
        return true;
      }

      const days = parseInt(parts[2] || '30');
      const targetPhone = this.normalizePhoneNumber(rawTargetPhone);

      let student = await this.studentPort.findByPhone(targetPhone);

      if (!student) {
        student = await this.studentPort.create(targetPhone, 'Alumno Nuevo');
      }

      const expiration = new Date();

      expiration.setDate(expiration.getDate() + days);

      await this.studentPort.updateAccessExpiration(student.id, expiration);
      await this.whatsappProvider.sendMessage(
        adminPhone,
        `✅ Habilitado ${targetPhone}\nHasta: ${expiration.toLocaleDateString()}`,
      );

      return true;
    }

    // Comando: Baja 1122334455
    if (command === 'baja') {
      const rawTargetPhone = parts[1];

      if (!rawTargetPhone) {
        await this.whatsappProvider.sendMessage(
          adminPhone,
          '❌ Faltó el número.\nUso: Baja [telefono]',
        );
        return true;
      }

      const targetPhone = this.normalizePhoneNumber(rawTargetPhone);

      const student = await this.studentPort.findByPhone(targetPhone);

      if (student) {
        // Fecha en el pasado = vencido
        await this.studentPort.updateAccessExpiration(student.id, new Date(0));
        await this.whatsappProvider.sendMessage(
          adminPhone,
          `🚫 Acceso revocado para ${targetPhone}`,
        );
      } else {
        await this.whatsappProvider.sendMessage(
          adminPhone,
          '⚠️ No encontré a ese alumno.',
        );
      }
      return true;
    }

    // Comando: Lista (muestra todos los alumnos con acceso activo)
    if (command === 'lista') {
      const activeStudents = await this.studentPort.findAllWithActiveAccess();

      if (activeStudents.length === 0) {
        await this.whatsappProvider.sendMessage(
          adminPhone,
          '📋 No hay alumnos con acceso activo actualmente.',
        );
        return true;
      }

      const studentList = activeStudents
        .map((s) => {
          const expDate = s.accessExpiresAt
            ? new Date(s.accessExpiresAt).toLocaleDateString()
            : 'N/A';
          return `• ${s.phoneNumber} (${s.name}) - Acceso vence: ${expDate}`;
        })
        .join('\n');

      await this.whatsappProvider.sendMessage(
        adminPhone,
        `📋 *Alumnos con acceso activo (${activeStudents.length}):*\n\n${studentList}`,
      );
      return true;
    }

    return false;
  }

  // --- PRIVATE HELPERS (Clean Code) ---

  /**
   * Limpia el número de teléfono removiendo el 9 del prefijo 549.
   * Parche para Argentina en Sandbox: 549... → 54...
   */
  private cleanPhoneNumber(phone: string): string {
    if (phone.startsWith('549')) {
      return phone.replace('549', '54');
    }
    return phone;
  }

  /**
   * Normaliza un número de teléfono:
   * 1. Agrega prefijo 54 si no lo tiene
   * 2. Limpia el 9 de 549 si existe
   */
  private normalizePhoneNumber(phone: string): string {
    let normalized = phone;

    if (!normalized.startsWith('54')) {
      normalized = '54' + normalized;
    }

    return this.cleanPhoneNumber(normalized);
  }

  private async getOrCreateStudent(
    from: string,
    contactName: string | null,
  ): Promise<StudentData> {
    let student = await this.studentPort.findByPhone(from);

    if (!student) {
      student = await this.studentPort.create(
        from,
        contactName || 'Sin Nombre',
      );
      this.logger.log(`🆕 Nuevo alumno creado: ${from}`);
    }
    return student;
  }

  private async handleReset(student: StudentData) {
    await this.conversationPort.create(student);
    await this.whatsappProvider.sendMessage(
      student.phoneNumber,
      '🔄 Conversación reiniciada. Escribí "Hola" para empezar.',
    );
  }

  private async getOrCreateConversation(student: StudentData) {
    let conversation = await this.conversationPort.findActiveByStudent(
      student.id,
    );

    if (!conversation) {
      conversation = await this.conversationPort.create(student);
    }

    return conversation;
  }

  private async processConversationStep(
    conversation: ConversationData,
    textBody: string,
  ) {
    switch (conversation.step) {
      case ConversationStep.WELCOME:
        await this.handleWelcome(conversation);
        break;

      case ConversationStep.LEARNING:
        await this.handleLearning(conversation, textBody);
        break;

      default:
        this.logger.warn(`Estado desconocido: ${conversation.step}`);

        await this.whatsappProvider.sendMessage(
          conversation.student.phoneNumber,
          'Hubo un error en mi memoria. Escribí "reset" para reiniciar.',
        );
    }
  }

  // --- HANDLERS DE ESTADOS ---

  private async handleWelcome(conversation: ConversationData): Promise<void> {
    let studentName = conversation.student.name?.trim();

    if (!studentName || studentName === 'Sin Nombre') {
      studentName = 'Futuro Conductor/a';
    }

    const welcomeMessage = `🚗 *Autoescuela GMC* \n\nHola ${studentName}! Soy tu asistente virtual para preparar el examen teórico de conducir. 🧠\n\nPreguntame lo que quieras sobre:\n• Señales de tránsito\n• Prioridades de paso\n• Velocidades máximas\n• Documentación obligatoria\n• Y mucho más...\n\n¡Escribí tu duda y te ayudo!`;

    await this.whatsappProvider.sendMessage(
      conversation.student.phoneNumber,
      welcomeMessage,
    );
    await this.conversationPort.updateStep(
      conversation.id,
      ConversationStep.LEARNING,
    );
  }

  private async handleLearning(conversation: ConversationData, text: string) {
    // Detectar saludos para enviar Bienvenida predefinida (Ahorra AI + UX Consistente)
    const greetings = ['hola', 'buen dia', 'buen día', 'buenas', 'hi', 'hello'];

    if (greetings.includes(text.trim().toLowerCase())) {
      await this.handleWelcome(conversation);
      return;
    }

    if (!this.checkRateLimit(conversation.student.phoneNumber)) {
      await this.whatsappProvider.sendMessage(
        conversation.student.phoneNumber,
        `⏳ Te pasaste un poco de velocidad.\n\nPara cuidar el sistema, tenés un límite de preguntas por hora. Esperá un ratito y volvé a intentar.`,
      );
      return;
    }

    const aiResponse = await this.knowledgeService.ask(text);

    await this.whatsappProvider.sendMessage(
      conversation.student.phoneNumber,
      aiResponse,
    );
  }

  // --- UTILS ---

  private checkRateLimit(phoneNumber: string): boolean {
    const now = Date.now();
    const record = this.usageMap.get(phoneNumber);

    // Si no existe o ya expiró la ventana, reiniciamos
    if (!record || now > record.expiresAt) {
      this.usageMap.set(phoneNumber, {
        count: 1,
        expiresAt: now + this.RATE_LIMIT_WINDOW,
      });
      return true;
    }

    // Si superó el límite
    if (record.count >= this.MAX_REQUESTS_PER_WINDOW) {
      return false;
    }

    // Incrementamos
    record.count++;
    return true;
  }
}
