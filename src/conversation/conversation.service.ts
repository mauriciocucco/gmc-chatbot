import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationStep } from './enums/conversation-step.enum';
import type { Student } from '../student/entities/student.entity';

/**
 * @deprecated Usar ConversationAdapter a través del puerto ConversationPort
 * Este servicio se mantiene temporalmente por compatibilidad.
 */
@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
  ) {}

  async findActiveByStudent(studentId: string): Promise<Conversation | null> {
    return this.conversationRepository.findOne({
      where: {
        student: { id: studentId },
        isActive: true,
      },
      order: { lastInteractionAt: 'DESC' },
      relations: ['student'],
    });
  }

  async create(student: Student): Promise<Conversation> {
    // Primero desactivamos cualquier conversación anterior
    await this.conversationRepository.update(
      { student: { id: student.id }, isActive: true },
      { isActive: false },
    );

    const newConv = this.conversationRepository.create({
      student: { id: student.id },
      step: ConversationStep.WELCOME,
      context: {},
    } as DeepPartial<Conversation>);

    return this.conversationRepository.save(newConv);
  }

  async updateStep(
    conversationId: string,
    step: ConversationStep,
    newContext?: Record<string, unknown>,
  ): Promise<void> {
    const conversation = await this.conversationRepository.findOneBy({
      id: conversationId,
    });

    if (!conversation) {
      return;
    }

    conversation.step = step;

    if (newContext !== undefined) {
      conversation.context = newContext;
    }

    await this.conversationRepository.save(conversation);
  }

  async deactivate(conversationId: string): Promise<void> {
    await this.conversationRepository.update(conversationId, {
      isActive: false,
    });
  }
}
