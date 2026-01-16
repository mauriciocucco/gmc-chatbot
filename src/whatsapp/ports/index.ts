// Estudiantes
export type { StudentPort, StudentData } from './student.port';
export { STUDENT_PORT } from './student.port';

// Conversaciones
export type { ConversationPort, ConversationData } from './conversation.port';
export { CONVERSATION_PORT } from './conversation.port';

// Citas
export type {
  AppointmentPort,
  StudentForAppointment,
} from './appointment.port';
export { APPOINTMENT_PORT } from './appointment.port';

// Proveedor de WhatsApp
export type { WhatsappProviderPort } from './whatsapp-provider.port';
export { WHATSAPP_PROVIDER } from './whatsapp-provider.port';
