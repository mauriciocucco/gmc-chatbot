import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { WhatsappProviderPort } from '../ports/whatsapp-provider.port';
import { WhatsappSendMessageResponse } from '../types/whatsapp-send-message-response.type';
import { extractWhatsappSendMessageErrorMessage } from '../utils/whatsapp.utils';

/**
 * Adaptador: Implementa el envío de mensajes usando HttpService (Axios).
 */
@Injectable()
export class WhatsappProviderAdapter implements WhatsappProviderPort {
  private readonly logger = new Logger(WhatsappProviderAdapter.name);
  private readonly apiUrl = 'https://graph.facebook.com/v22.0';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  async sendMessage(
    to: string,
    text: string,
  ): Promise<WhatsappSendMessageResponse | undefined> {
    const token = this.configService.get<string>('WHATSAPP_API_TOKEN');
    const phoneId = this.configService.get<string>('WHATSAPP_PHONE_ID');
    const url = `${this.apiUrl}/${phoneId}/messages`;
    const data = {
      messaging_product: 'whatsapp',
      to,
      text: { body: text },
      type: 'text',
    };
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await lastValueFrom(
        this.httpService.post<WhatsappSendMessageResponse>(url, data, {
          headers,
        }),
      );

      this.logger.log(`✅ Mensaje enviado a ${to}`);
      return response.data;
    } catch (error: unknown) {
      const errorMessage = extractWhatsappSendMessageErrorMessage(error);

      this.logger.error(`❌ Error enviando mensaje: ${errorMessage}`);
      return undefined;
    }
  }
}
