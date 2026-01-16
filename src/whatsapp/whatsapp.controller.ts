import {
  Controller,
  Get,
  Query,
  Res,
  HttpStatus,
  Post,
  Body,
  UseGuards, // <---
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import type { Response } from 'express';
import { WhatsappSignatureGuard } from './guards/whatsapp-signature.guard'; // <---

@Controller('webhook')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const responseChallenge = this.whatsappService.verifyWebhook(
      mode,
      token,
      challenge,
    );

    // Meta espera un 200 OK y el challenge como TEXTO PLANO (no JSON)
    res.status(HttpStatus.OK).send(responseChallenge);
  }

  @Post()
  @UseGuards(WhatsappSignatureGuard) // <--- Candado activado
  handleIncomingMessage(@Body() body: any, @Res() res: Response) {
    // 1. Siempre responder 200 OK a Meta inmediatamente.
    // Si tardamos mucho procesando, Meta considera que falló y reintenta el envío.
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    // 2. Delegar el procesamiento al servicio (fire and forget)
    void this.whatsappService.handleMessage(body);
  }
}
