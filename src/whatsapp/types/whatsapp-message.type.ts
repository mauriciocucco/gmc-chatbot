export type WhatsappMessage = {
  from: string;
  type: string;
  text?: {
    body?: string;
  };
};
