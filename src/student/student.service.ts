import { Injectable } from '@nestjs/common';
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

  async createStudent(
    phoneNumber: string,
    name: string = 'Sin Nombre',
  ): Promise<Student> {
    const newStudent = this.studentRepository.create({
      phoneNumber,
      name,
    });
    return this.studentRepository.save(newStudent);
  }
}
