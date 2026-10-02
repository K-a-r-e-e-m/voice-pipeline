import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { SttService } from './stt.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'STT_PACKAGE',
        transport: Transport.GRPC,
        options: {
          package: 'stt',
          protoPath: join(__dirname, '../../proto/stt.proto'),
          url: process.env.STT_GRPC_URL || 'localhost:50051',
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
  providers: [SttService],
  exports: [SttService],
})
export class SttModule {}
