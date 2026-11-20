import { Test } from '@nestjs/testing';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module';
import { ProcessingQueueService } from './processing/processing-queue.service';
import { VideoUploadService } from './video-upload.service';
import { VideosController } from './videos.controller';
import { buildSwaggerConfig } from '../swagger/swagger-document';

describe('VideosModule API graph (integration)', () => {
  it('resolves the API graph and exports video routes without queue consumers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig());

    expect(moduleRef.get(VideosController)).toBeInstanceOf(VideosController);
    expect(moduleRef.get(VideoUploadService)).toBeInstanceOf(
      VideoUploadService,
    );
    expect(() =>
      moduleRef.get(ProcessingQueueService, { strict: false }),
    ).toThrow();
    expect(document.paths).toEqual(
      expect.objectContaining({
        '/videos': expect.any(Object),
        '/videos/{publicId}': expect.any(Object),
        '/videos/{publicId}/upload': expect.any(Object),
        '/videos/{publicId}/upload/parts': expect.any(Object),
        '/videos/{publicId}/upload/completion': expect.any(Object),
      }),
    );

    await app.close();
  });
});
