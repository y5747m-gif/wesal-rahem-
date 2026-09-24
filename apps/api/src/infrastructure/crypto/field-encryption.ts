import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FieldEncryptionService } from '../../application/ports/services';

/**
 * تشفير الحقول الحساسة في التخزين (أرقام الهواتف، رموز الدفع، عناوين المستلمين).
 *
 *  - AES-256-GCM: سرية + سلامة (أي تعديل يُكتشف).
 *  - HMAC-SHA256 بمفتاح مشتق: بصمة ثابتة للبحث والمقارنة دون كشف القيمة.
 *  - الصيغة: `v1:<base64url(iv|authTag|ciphertext)>` حتى نستطيع تدوير المفتاح لاحقًا.
 *
 * مبدأ أقل قدر من البيانات: لا نخزّن ما لا نحتاجه، ولا نفكّ التشفير إلا لمن يملك الصلاحية.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 'v1';

export class AesFieldEncryption implements FieldEncryptionService {
  private readonly key: Buffer;
  private readonly hmacKey: Buffer;

  constructor(hexKey: string) {
    const normalized = (hexKey ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      throw new Error(
        'FIELD_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
          'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    this.key = Buffer.from(normalized, 'hex');
    // مفتاح مشتق للبصمات حتى لا يُستخدم مفتاح التشفير مباشرة في HMAC
    this.hmacKey = createHmac('sha256', this.key).update('wesal/field-index/v1').digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, encrypted]);
    return `${VERSION}:${payload.toString('base64url')}`;
  }

  decrypt(ciphertext: string): string | null {
    if (!ciphertext) return null;
    const [version, body] = ciphertext.split(':');
    if (version !== VERSION || !body) return null;
    try {
      const payload = Buffer.from(body, 'base64url');
      if (payload.length < IV_LENGTH + TAG_LENGTH) return null;
      const iv = payload.subarray(0, IV_LENGTH);
      const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const data = payload.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      // قيمة تالفة أو مفتاح مختلف — لا نكشف التفاصيل
      return null;
    }
  }

  hmac(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value, 'utf8').digest('hex');
  }

  /** مقارنة آمنة ضد هجمات التوقيت */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /** إخفاء جزء من الرقم للعرض: ‎+20•••••3456 */
  mask(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/[^\d+]/g, '');
    if (digits.length <= 4) return '•'.repeat(digits.length);
    const prefix = digits.startsWith('+') ? digits.slice(0, 3) : digits.slice(0, 2);
    const suffix = digits.slice(-3);
    const hidden = Math.max(2, digits.length - prefix.length - suffix.length);
    return `${prefix}${'•'.repeat(hidden)}${suffix}`;
  }
}
