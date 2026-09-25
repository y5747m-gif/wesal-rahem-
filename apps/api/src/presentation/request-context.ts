import type { Request } from 'express';
import type { RequestContext } from '../application/use-cases/auth.use-case';

export function requestContext(req: Request): RequestContext {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0])?.trim() || req.ip || null;
  return { ip, userAgent: (req.headers['user-agent'] ?? null) as string | null };
}
