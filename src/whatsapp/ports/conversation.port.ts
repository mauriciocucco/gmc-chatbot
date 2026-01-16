import { ConversationStep } from '../../conversation/enums/conversation-step.enum';
import type { StudentData } from './student.port';

/**
 * Puerto de salida: Define el contrato que debe cumplir cualquier
 * servicio que gestione conversaciones para el flujo de WhatsApp.
 *
 * Why: Arquitectura Hexagonal - El dominio (WhatsappService) no conoce
 * la implementación concreta (TypeORM), solo este contrato.
 */
export interface ConversationPort {
  findActiveByStudent(studentId: string): Promise<ConversationData | null>;
  create(student: StudentData): Promise<ConversationData>;
  updateStep(
    conversationId: string,
    step: ConversationStep,
    context?: Record<string, unknown>,
  ): Promise<void>;
  deactivate(conversationId: string): Promise<void>;
}

/**
 * DTO que representa los datos de una conversación para el dominio.
 * No es una entidad de TypeORM, es un objeto de transferencia puro.
 */
export interface ConversationData {
  id: string;
  step: ConversationStep;
  context: Record<string, unknown>;
  isActive: boolean;
  student: StudentData;
}

/**
 * Token de inyección para el puerto.
 * NestJS usará esto para resolver la dependencia.
 */
export const CONVERSATION_PORT = Symbol('CONVERSATION_PORT');
