import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from './entities/student.entity';
import { StudentPort, StudentData } from '../whatsapp/ports/student.port';

/**
 * Adaptador: Implementa el puerto StudentPort usando TypeORM.
 */
@Injectable()
export class StudentAdapter implements StudentPort {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
  ) {}

  async findByPhone(phoneNumber: string): Promise<StudentData | null> {
    const student = await this.studentRepository.findOneBy({ phoneNumber });

    if (!student) {
      return null;
    }

    return this.toData(student);
  }

  async create(phoneNumber: string, name: string): Promise<StudentData> {
    const newStudent = this.studentRepository.create({
      phoneNumber,
      name,
    });

    const saved = await this.studentRepository.save(newStudent);
    return this.toData(saved);
  }

  async updateAccessExpiration(studentId: string, date: Date): Promise<void> {
    await this.studentRepository.update(studentId, { accessExpiresAt: date });
  }

  private toData(student: Student): StudentData {
    return {
      id: student.id,
      name: student.name,
      phoneNumber: student.phoneNumber,
      accessExpiresAt: student.accessExpiresAt,
    };
  }
}
