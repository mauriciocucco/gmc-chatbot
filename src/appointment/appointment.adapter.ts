import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment, AppointmentStatus } from './entities/appointment.entity';
import {
  AppointmentPort,
  StudentForAppointment,
} from '../whatsapp/ports/appointment.port';

/**
 * Adaptador: Implementa el puerto AppointmentPort usando TypeORM.
 */
@Injectable()
export class AppointmentAdapter implements AppointmentPort {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
  ) {}

  async create(
    student: StudentForAppointment,
    dateText: string,
  ): Promise<void> {
    const appointment = this.appointmentRepository.create({
      student: { id: student.id },
      requestedDate: dateText,
      status: AppointmentStatus.PENDING,
    });

    await this.appointmentRepository.save(appointment);
  }
}
