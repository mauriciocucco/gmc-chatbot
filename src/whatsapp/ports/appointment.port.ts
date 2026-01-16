/**
 * Puerto de salida: Define el contrato para crear turnos/citas.
 */
export interface AppointmentPort {
  create(student: StudentForAppointment, dateText: string): Promise<void>;
}

export interface StudentForAppointment {
  id: string;
  name: string;
  phoneNumber: string;
}

export const APPOINTMENT_PORT = Symbol('APPOINTMENT_PORT');
