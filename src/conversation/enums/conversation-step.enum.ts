export enum ConversationStep {
  WELCOME = 'WELCOME', // Estado inicial (no ha interactuado aún)
  MENU = 'MENU', // Se le mostró el menú, esperamos que elija
  LEARNING = 'LEARNING', // Modo instructor (RAG)
  APPOINTMENT_DATE = 'APPOINTMENT_DATE', // Esperando que escriba la fecha
  APPOINTMENT_CONFIRM = 'APPOINTMENT_CONFIRM', // Esperando confirmación final
  FINISHED = 'FINISHED', // Conversación cerrada
}
