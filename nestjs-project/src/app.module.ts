import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import mailConfig from './config/mail.config';
import swaggerConfig from './config/swagger.config';
import storageConfig from './config/storage.config';
import queueConfig from './config/queue.config';
import videoConfig from './config/video.config';
import { envValidationSchema } from './config/env.validation';
import { VideosModule } from './videos/videos.module';
import { assertConnectedTestDatabase } from './test/test-database-safety';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        mailConfig,
        swaggerConfig,
        storageConfig,
        queueConfig,
        videoConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) {
          throw new Error('TypeORM data source options are required');
        }
        const dataSource = await new DataSource(options).initialize();
        if (process.env.NODE_ENV === 'test') {
          try {
            const username =
              'username' in options ? String(options.username) : '';
            await assertConnectedTestDatabase(
              dataSource.query.bind(dataSource),
              options.database as string,
              username,
            );
          } catch (error) {
            await dataSource.destroy();
            throw error;
          }
        }
        return dataSource;
      },
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    AuthModule,
    VideosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
