/**
 * Puerto de salida: Define el contrato para gestionar estudiantes.
 */
export interface StudentPort {
  findByPhone(phoneNumber: string): Promise<StudentData | null>;
  create(phoneNumber: string, name: string): Promise<StudentData>;
  updateAccessExpiration(studentId: string, date: Date): Promise<void>; // <--- New method
}

export interface StudentData {
  id: string;
  name: string;
  phoneNumber: string;
  accessExpiresAt?: Date; // <--- New field
}

export const STUDENT_PORT = Symbol('STUDENT_PORT');
