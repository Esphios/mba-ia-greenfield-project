import {
  CanActivate,
  ExecutionContext,
  Injectable,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { BodyTooLargeException } from './video-domain.exception';

@Injectable()
export class VideoBodyLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const contentLength = Number(request.headers['content-length'] ?? 0);
    if (
      (Number.isFinite(contentLength) && contentLength > 65_536) ||
      (request.rawBody?.byteLength ?? 0) > 65_536
    ) {
      throw new BodyTooLargeException();
    }
    return true;
  }
}
