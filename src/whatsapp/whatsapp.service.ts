import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappMessage } from './types/whatsapp-message.type';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { WhatsappSendMessageResponse } from './types/whatsapp-send-message-response.type';
import { StudentService } from '../student/student.service';

/**
 * Why: La carga del webhook viene como JSON no confiable; tiparla como `unknown` y validarla
 * evita accesos inseguros (`any`) y reduce fallos cuando Meta cambia/omite campos (edge-cases).
 */
export function extractFirstWhatsappMessage(
  webhookData: unknown,
): WhatsappMessage | null {
  if (!isRecord(webhookData)) {
    return null;
  }

  const entry = webhookData.entry;

  if (!Array.isArray(entry) || entry.length === 0 || !isRecord(entry[0])) {
    return null;
  }

  const changes = entry[0].changes;

  if (
    !Array.isArray(changes) ||
    changes.length === 0 ||
    !isRecord(changes[0])
  ) {
    return null;
  }

  const value = changes[0].value;

  if (!isRecord(value)) {
    return null;
  }

  const messages = value.messages;

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    !isRecord(messages[0])
  ) {
    return null;
  }

  const from = messages[0].from;
  const type = messages[0].type;

  if (typeof from !== 'string' || typeof type !== 'string') {
    return null;
  }

  const text = messages[0].text;
  const normalizedText = isRecord(text)
    ? { body: typeof text.body === 'string' ? text.body : undefined }
    : undefined;

  return { from, type, text: normalizedText };
}

/**
 * Why: `webhookData` es `unknown`; extraer el nombre vía validación evita accesos inseguros
 * cuando Meta cambia/omite campos (edge-case común en webhooks).
 */
export function extractWhatsappContactName(
  webhookData: unknown,
): string | undefined {
  if (!isRecord(webhookData)) {
    return undefined;
  }

  const entry = webhookData.entry;

  if (!Array.isArray(entry) || entry.length === 0 || !isRecord(entry[0])) {
    return undefined;
  }

  const changes = entry[0].changes;

  if (
    !Array.isArray(changes) ||
    changes.length === 0 ||
    !isRecord(changes[0])
  ) {
    return undefined;
  }

  const value = changes[0].value;

  if (!isRecord(value)) {
    return undefined;
  }

  const contacts = value.contacts;

  if (
    !Array.isArray(contacts) ||
    contacts.length === 0 ||
    !isRecord(contacts[0])
  ) {
    return undefined;
  }

  const profile = contacts[0].profile;

  if (!isRecord(profile)) {
    return undefined;
  }

  const name = profile.name;

  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Why: `catch` puede recibir valores no-Error (y/o AxiosError con `response.data` variable);
 * esta función evita accesos inseguros y prioriza el mensaje específico de Meta si existe.
 *
 * Edge-cases: `response.data` puede ser string/objeto; `error` puede ser string/number/null.
 */
export function extractWhatsappSendMessageErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    // Why: Axios tipa `response.data` como `any`; lo convertimos a `unknown` para evitar
    // asignaciones inseguras y obligarnos a validar antes de acceder a propiedades.
    const responseData = error.response?.data as unknown;

    if (isRecord(responseData)) {
      const metaError = responseData.error;

      if (isRecord(metaError) && typeof metaError.message === 'string') {
        return metaError.message;
      }
    }

    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiUrl = 'https://graph.facebook.com/v22.0';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly studentService: StudentService,
  ) {}

  /**
   * Maneja la verificación del Webhook (Handshake).
   * Compara el token enviado por Meta con el token local.
   */
  verifyWebhook(mode: string, token: string, challenge: string): string {
    const verifyToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (!mode || !token) {
      throw new ForbiddenException('Faltan parámetros de verificación');
    }

    // Validamos que el modo sea 'subscribe' y el token coincida
    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('✅ Webhook verificado correctamente.');

      return challenge; // Retornamos el challenge como texto plano
    }

    throw new ForbiddenException('Token de verificación inválido');
  }

  async handleMessage(webhookData: unknown) {
    // El objeto viene con una estructura compleja: entry[0].changes[0].value.messages[0]
    const messageData = extractFirstWhatsappMessage(webhookData);
    const contactName = extractWhatsappContactName(webhookData);

    // Si no hay mensaje (puede ser una notificación de estado), ignoramos por ahora
    if (!messageData) {
      return;
    }

    const from = messageData.from;
    const type = messageData.type;

    if (type === 'text') {
      const textBody = messageData.text?.body;
      let student = await this.studentService.findOneByPhone(from);

      if (!student) {
        this.logger.log(`🆕 Nuevo alumno detectado: ${from}`);
        // Creamos al alumno usando el nombre de su perfil de WhatsApp si existe
        student = await this.studentService.createStudent(
          from,
          contactName || 'Alumno Nuevo',
        );
        await this.sendMessage(
          from,
          `¡Hola! 👋 Bienvenido a Autoescuela GMC. Ya te registramos en nuestro sistema.`,
        );
      } else {
        this.logger.log(`👤 Alumno existente: ${student.name} (${from})`);
        await this.sendMessage(
          from,
          `Hola de nuevo ${student.name}! Recibí: ${textBody}`,
        );
      }
      // -------------------------------
    }
  }

  async sendMessage(
    to: string,
    text: string,
  ): Promise<WhatsappSendMessageResponse | undefined> {
    const token = this.configService.get<string>('WHATSAPP_API_TOKEN');
    const phoneId = this.configService.get<string>('WHATSAPP_PHONE_ID');
    const url = `${this.apiUrl}/${phoneId}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      to: to,
      text: { body: text },
      type: 'text',
    };
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      // Nest HttpService devuelve un Observable, lo convertimos a Promesa
      const response = await lastValueFrom(
        this.httpService.post<WhatsappSendMessageResponse>(url, data, {
          headers,
        }),
      );

      this.logger.log(`✅ Mensaje enviado a ${to}`);

      return response.data;
    } catch (error: unknown) {
      const errorMessage = extractWhatsappSendMessageErrorMessage(error);

      this.logger.error(`❌ Error enviando mensaje: ${errorMessage}`);

      return undefined;
    }
  }
}
