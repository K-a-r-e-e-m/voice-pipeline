import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { TtsService } from './tts.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'TTS_PACKAGE',
        transport: Transport.GRPC,
        options: {
          package: 'tts',
          protoPath: join(__dirname, '../../proto/tts.proto'),
          url: process.env.TTS_GRPC_URL || 'localhost:50052',
          loader: {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
          },
        },
      },
    ]),
  ],
  providers: [TtsService],
  exports: [TtsService],
})
export class TtsModule {}
