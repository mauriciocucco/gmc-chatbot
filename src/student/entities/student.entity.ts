import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import type { Conversation } from '../../conversation/entities/conversation.entity';

@Entity('students')
export class Student {
  @PrimaryGeneratedColumn('uuid') // Usar UUID es más seguro y escalable que ID numérico
  id: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  name: string;

  @Column({ type: 'varchar', unique: true }) // El teléfono es el identificador único de negocio
  phoneNumber: string;

  // --- NUEVO CAMPO: Fecha de Expiración ---
  @Column({ type: 'timestamp', nullable: true })
  accessExpiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany('Conversation', 'student')
  conversations: Conversation[];
}
