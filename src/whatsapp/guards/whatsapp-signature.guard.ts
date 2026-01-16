import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';

// Extender interfaz Request para incluir rawBody (NestJS lo agrega con { rawBody: true })
interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@Injectable()
export class WhatsappSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WhatsappSignatureGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithRawBody>();
    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET');
    const signature = request.headers['x-hub-signature-256'] as string;

    if (!appSecret) {
      this.logger.warn(
        'WHATSAPP_APP_SECRET no está configurado. Saltando validación de firma.',
      );
      return true; // Permitir si no hay secreto (para dev), pero loguear warning warning
    }

    if (!signature) {
      throw new UnauthorizedException('Falta la firma X-Hub-Signature-256');
    }

    if (!request.rawBody) {
      this.logger.error(
        'RawBody no disponible. Asegurate de habilitar { rawBody: true } en main.ts',
      );
      throw new UnauthorizedException('Error interno de validación');
    }

    const expectedSignature =
      'sha256=' +
      crypto
        .createHmac('sha256', appSecret)
        .update(request.rawBody)
        .digest('hex');

    // Comparación segura contra Timing Attacks
    if (signature !== expectedSignature) {
      this.logger.error(
        `Firma inválida. Recibida: ${signature}, Esperada: ${expectedSignature}`,
      );
      throw new UnauthorizedException('Firma inválida');
    }

    return true;
  }
}
