import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Student } from '../../student/entities/student.entity';
import { ConversationStep } from '../enums/conversation-step.enum';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ConversationStep,
    default: ConversationStep.WELCOME,
  })
  step: ConversationStep;

  // JSONB es clave: nos permite guardar datos variables (ej: { fecha: '2025-01-20', servicio: 'clase_manejo' })
  @Column({ type: 'jsonb', default: {} })
  context: Record<string, unknown>;

  @Column({ default: true })
  isActive: boolean;

  @ManyToOne('Student', 'conversations')
  student: Student;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastInteractionAt: Date;
}
