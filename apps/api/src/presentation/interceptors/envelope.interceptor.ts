import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiSuccess } from '@wesal/shared';

/** كل استجابة ناجحة تُغلَّف بـ `{ ok: true, data }` — شكل واحد يعتمد عليه التطبيق */
@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    const response = context.switchToHttp().getResponse<{ getHeader?: (name: string) => unknown }>();
    return next.handle().pipe(
      map((data) => {
        // الصفحات العامة (HTML) لا تُغلَّف
        const type = response.getHeader?.('content-type');
        if (typeof type === 'string' && type.includes('text/html')) return data;
        return { ok: true as const, data };
      }),
    );
  }
}
