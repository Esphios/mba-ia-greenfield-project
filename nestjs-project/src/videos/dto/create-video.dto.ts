import { ApiProperty } from '@nestjs/swagger';
import { MAX_VIDEO_BYTES } from '../../common/video-limits';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateVideoDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  title: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  filename: string;

  @ApiProperty({ minimum: 1, maximum: MAX_VIDEO_BYTES })
  @IsInt()
  @Min(1)
  sizeBytes: number;

  @ApiProperty({ enum: ['video/mp4'] })
  @IsString()
  contentType: string;
}
