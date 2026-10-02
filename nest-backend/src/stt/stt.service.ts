import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { STTGrpcClient, TranscriptionResponse } from './stt.interface';

@Injectable()
export class SttService implements OnModuleInit {
  private readonly logger = new Logger(SttService.name);
  private sttGrpcClient: STTGrpcClient;

  constructor(@Inject('STT_PACKAGE') private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.sttGrpcClient = this.client.getService<STTGrpcClient>('STTService');
    this.logger.log('STT gRPC client initialized successfully.');
  }

  async transcribe(
    audioBuffer: Buffer,
    audioFormat = 'wav',
    sampleRate = 16000,
  ): Promise<TranscriptionResponse> {
    this.logger.log(
      `Sending audio to STT gRPC service (${audioBuffer.length} bytes, format: ${audioFormat})...`,
    );

    try {
      const response = await firstValueFrom(
        this.sttGrpcClient.transcribe({
          audio_data: audioBuffer,
          audio_format: audioFormat,
          sample_rate: sampleRate,
        }),
      );

      this.logger.log(
        `STT Transcription completed: "${response.text}" in ${response.inference_time_seconds}s`,
      );
      return response;
    } catch (error) {
      this.logger.error(`STT gRPC call failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
