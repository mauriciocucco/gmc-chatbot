import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import type { Student } from '../../student/entities/student.entity';

export enum AppointmentStatus {
  PENDING = 'PENDING', // Solicitado por el bot, falta aprobar
  CONFIRMED = 'CONFIRMED', // Tu hermano lo aprobó
  REJECTED = 'REJECTED', // No se puede ese horario
  CANCELLED = 'CANCELLED', // El alumno canceló
}

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Por ahora lo guardamos como texto (ej: "Lunes 10hs") para no complicarnos con parsing de fechas todavía
  @Column()
  requestedDate: string;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    default: AppointmentStatus.PENDING,
  })
  status: AppointmentStatus;

  @ManyToOne('Student', 'appointments')
  student: Student;

  @CreateDateColumn()
  createdAt: Date;
}
