import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DomainExceptionFilter } from '../common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../common/filters/validation-exception.filter';
import { json, type NextFunction, type Request, type Response } from 'express';

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

export function configureHttpApplication(app: INestApplication): void {
  app.use(
    '/videos',
    (request: Request, response: Response, next: NextFunction) => {
      const hasBody =
        Number(request.headers['content-length'] ?? 0) > 0 ||
        request.headers['transfer-encoding'] !== undefined;
      if (hasBody && !request.is('application/json')) {
        response.status(415).json({
          statusCode: 415,
          error: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Video control bodies must use application/json',
        });
        return;
      }
      next();
    },
  );
  app.use(
    '/videos',
    json({
      limit: 65_536,
      type: 'application/json',
      inflate: true,
      strict: true,
      verify: (request, _response, buffer) => {
        (request as Request & { rawBody?: Buffer }).rawBody =
          Buffer.from(buffer);
      },
    }),
  );
  app.use(
    '/videos',
    (
      error: BodyParserError,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error.type === 'entity.too.large') {
        response.status(413).json({
          statusCode: 413,
          error: 'BODY_TOO_LARGE',
          message: 'Video control body exceeds 64KiB',
        });
        return;
      }
      if (error.type === 'encoding.unsupported' || error.status === 415) {
        response.status(415).json({
          statusCode: 415,
          error: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Unsupported request encoding',
        });
        return;
      }
      if (error.type === 'entity.parse.failed') {
        response.status(400).json({
          statusCode: 400,
          error: 'VALIDATION_ERROR',
          message: 'Request body must be valid JSON',
        });
        return;
      }
      next(error);
    },
  );
  app.use(json({ limit: '100kb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
}
