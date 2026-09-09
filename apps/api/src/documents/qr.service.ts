import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';

/** document-engine.md §4: the QR encodes a public verify URL keyed on the opaque `qr_token`, never the document's row id or number. */
@Injectable()
export class QrService {
  constructor(private readonly config: ConfigService) {}

  verifyUrl(qrToken: string): string {
    const base = this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:3000';
    return `${base.replace(/\/$/, '')}/verify/${qrToken}`;
  }

  async dataUri(qrToken: string): Promise<string> {
    return QRCode.toDataURL(this.verifyUrl(qrToken), { margin: 1, width: 160 });
  }
}
