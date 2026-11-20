import { BadRequestException, PipeTransform } from '@nestjs/common';

export class PlainObjectBodyPipe implements PipeTransform {
  constructor(private readonly allowUndefined = false) {}

  transform(value: unknown): unknown {
    if (value === undefined && this.allowUndefined) return value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
        message: 'Request body must be a JSON object',
      });
    }
    return value;
  }
}
