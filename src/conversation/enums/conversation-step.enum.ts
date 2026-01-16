export enum ConversationStep {
  WELCOME = 'WELCOME', // Estado inicial (no ha interactuado aún)
  MENU = 'MENU', // Se le mostró el menú, esperamos que elija
  LEARNING = 'LEARNING', // Modo instructor (RAG)
  FINISHED = 'FINISHED', // Conversación cerrada
}
