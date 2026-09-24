import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../../config/configuration';
import type { UrlBuilder } from '../../application/ports/services';

/**
 * باني الروابط العامة — رابط قبول الدعوة ورابط "أنا بخير".
 *
 * الروابط تحمل رمزًا عشوائيًا واحدًا فقط (لا معرّفات ولا أسماء):
 *  - فريد، وينتهي بعد وقت قصير، ولا يكشف بيانات.
 */
@Injectable()
export class HttpUrlBuilder implements UrlBuilder {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  private base(): string {
    return this.config.publicBaseUrl;
  }

  inviteAcceptUrl(token: string): string {
    return `${this.base()}/invite/${encodeURIComponent(token)}`;
  }

  webCheckInUrl(token: string): string {
    return `${this.base()}/fine/${encodeURIComponent(token)}`;
  }

  personUrl(personId: string): string {
    return `${this.base()}/persons/${encodeURIComponent(personId)}`;
  }
}
