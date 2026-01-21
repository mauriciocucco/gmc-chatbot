import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from './entities/student.entity';

@Injectable()
export class StudentService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
  ) {}

  async findOneByPhone(phoneNumber: string): Promise<Student | null> {
    return this.studentRepository.findOneBy({ phoneNumber });
  }

  /**
   * Crea un nuevo alumno en el sistema.
   *
   * @param phoneNumber Número de teléfono del alumno (identificador único)
   * @param name Nombre del alumno
   * @returns El alumno creado
   * @throws ConflictException si el alumno ya existe
   */
  async createStudent(
    phoneNumber: string,
    name: string = 'Sin Nombre',
  ): Promise<Student> {
    const existingStudent = await this.findOneByPhone(phoneNumber);

    if (existingStudent) {
      throw new ConflictException(
        `El alumno con el teléfono ${phoneNumber} ya existe en el sistema.`,
      );
    }

    const accessExpiresAt = new Date();
    accessExpiresAt.setDate(accessExpiresAt.getDate() + 30);

    const newStudent = this.studentRepository.create({
      phoneNumber,
      name,
      accessExpiresAt,
    });

    return this.studentRepository.save(newStudent);
  }
}
