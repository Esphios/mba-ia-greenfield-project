import { IsEmpty } from 'class-validator';

export class CompleteUploadDto {
  @IsEmpty()
  _empty?: never;
}
