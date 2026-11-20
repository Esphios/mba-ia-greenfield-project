import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from './channels/entities/channel.entity';
import databaseConfig from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import queueConfig from './config/queue.config';
import storageConfig from './config/storage.config';
import videoConfig from './config/video.config';
import { ProcessingModule } from './videos/processing/processing.module';
import { VideoWorkerRuntimeService } from './videos/processing/video-worker-runtime.service';
import { VideoPersistenceModule } from './videos/video-persistence.module';
import { User } from './users/entities/user.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, queueConfig, storageConfig, videoConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.name,
        entities: [User, Channel],
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    VideoPersistenceModule,
    ProcessingModule,
  ],
  providers: [VideoWorkerRuntimeService],
})
export class VideoWorkerModule {}
