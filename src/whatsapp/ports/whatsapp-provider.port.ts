import { WhatsappSendMessageResponse } from '../types/whatsapp-send-message-response.type';

/**
 * Puerto de salida: Define el contrato para enviar mensajes de WhatsApp.
 *
 * Why: Arquitectura Hexagonal - El dominio no debe saber si usamos Axios,
 * Fetch, o una librería externa para enviar los mensajes.
 */
export interface WhatsappProviderPort {
  sendMessage(
    to: string,
    text: string,
  ): Promise<WhatsappSendMessageResponse | undefined>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
