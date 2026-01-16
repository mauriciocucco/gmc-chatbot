import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationStep } from './enums/conversation-step.enum';
import type {
  ConversationPort,
  ConversationData,
} from '../whatsapp/ports/conversation.port';
import type { StudentData } from '../whatsapp/ports/student.port';

/**
 * Adaptador: Implementa el puerto ConversationPort usando TypeORM.
 *
 * Why: Arquitectura Hexagonal - Esta clase es infraestructura que
 * implementa el contrato definido en el puerto. Si cambiamos de ORM,
 * solo cambiamos este archivo.
 */
@Injectable()
export class ConversationAdapter implements ConversationPort {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
  ) {}

  async findActiveByStudent(
    studentId: string,
  ): Promise<ConversationData | null> {
    const conversation = await this.conversationRepository.findOne({
      where: {
        student: { id: studentId },
        isActive: true,
      },
      order: { lastInteractionAt: 'DESC' },
      relations: ['student'],
    });

    if (!conversation) {
      return null;
    }

    return this.toData(conversation);
  }

  async create(student: StudentData): Promise<ConversationData> {
    // Desactivar conversaciones anteriores
    await this.conversationRepository.update(
      { student: { id: student.id }, isActive: true },
      { isActive: false },
    );

    const newConversation = this.conversationRepository.create({
      student: { id: student.id },
      step: ConversationStep.WELCOME,
      context: {},
    } as DeepPartial<Conversation>);
    const saved = await this.conversationRepository.save(newConversation);

    // Retornamos con los datos del student que ya tenemos
    return {
      id: saved.id,
      step: saved.step,
      context: saved.context,
      isActive: saved.isActive,
      student: {
        id: student.id,
        name: student.name,
        phoneNumber: student.phoneNumber,
      },
    };
  }

  async updateStep(
    conversationId: string,
    step: ConversationStep,
    context?: Record<string, unknown>,
  ): Promise<void> {
    // Usamos save en lugar de update para evitar problemas con QueryDeepPartialEntity
    const conversation = await this.conversationRepository.findOneBy({
      id: conversationId,
    });

    if (!conversation) {
      return;
    }

    conversation.step = step;

    if (context !== undefined) {
      conversation.context = context;
    }

    await this.conversationRepository.save(conversation);
  }

  async deactivate(conversationId: string): Promise<void> {
    await this.conversationRepository.update(conversationId, {
      isActive: false,
    });
  }

  /**
   * Mapper: Entidad -> DTO de dominio
   */
  private toData(conversation: Conversation): ConversationData {
    return {
      id: conversation.id,
      step: conversation.step,
      context: conversation.context,
      isActive: conversation.isActive,
      student: {
        id: conversation.student.id,
        name: conversation.student.name,
        phoneNumber: conversation.student.phoneNumber,
      },
    };
  }
}
