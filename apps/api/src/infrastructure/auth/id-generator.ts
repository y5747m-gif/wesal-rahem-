import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../application/ports/services';

/** مولّد معرّفات ورموز — عشوائية تشفيرية دائمًا (crypto وليس Math.random). */
export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  numericCode(length = 6): string {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += String(randomInt(0, 10));
    }
    return out;
  }
}

/** مولّد ثابت للاختبارات — يجعل النتائج قابلة للتكرار */
export class FakeIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = 'test') {}

  uuid(): string {
    this.counter += 1;
    const hex = this.counter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  }

  randomToken(): string {
    this.counter += 1;
    return `${this.prefix}-token-${this.counter}`;
  }

  numericCode(length = 6): string {
    this.counter += 1;
    return String(this.counter).padStart(length, '0');
  }
}
