import { isAxiosError } from 'axios';
import { WhatsappMessage } from '../types/whatsapp-message.type';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

/**
 * Why: `catch` puede recibir valores no-Error (y/o AxiosError con `response.data` variable);
 * esta función evita accesos inseguros y prioriza el mensaje específico de Meta si existe.
 */
export function extractWhatsappSendMessageErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
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
