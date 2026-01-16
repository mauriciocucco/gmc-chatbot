import { ConversationStep } from '../../conversation/enums/conversation-step.enum';

export interface ConversationStudentSnapshot {
  id: string;
  name: string;
  phoneNumber: string;
}

export interface ConversationForWhatsappFlow {
  id: string;
  step: ConversationStep;
  student: ConversationStudentSnapshot;
  context?: unknown;
}
