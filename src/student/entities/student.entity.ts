import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('students')
export class Student {
  @PrimaryGeneratedColumn('uuid') // Usar UUID es más seguro y escalable que ID numérico
  id: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  name: string;

  @Column({ type: 'varchar', unique: true }) // El teléfono es el identificador único de negocio
  phoneNumber: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: true })
  isActive: boolean;
}
