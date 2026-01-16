import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment, AppointmentStatus } from './entities/appointment.entity';
import { Student } from '../student/entities/student.entity';

@Injectable()
export class AppointmentService {
  constructor(
    @InjectRepository(Appointment)
    private appointmentRepository: Repository<Appointment>,
  ) {}

  async create(student: Student, dateText: string): Promise<Appointment> {
    const appointment = this.appointmentRepository.create({
      student,
      requestedDate: dateText,
      status: AppointmentStatus.PENDING,
    });

    return this.appointmentRepository.save(appointment);
  }
}
