import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { TTSGrpcClient, SynthesizeResponse } from './tts.interface';

@Injectable()
export class TtsService implements OnModuleInit {
  private readonly logger = new Logger(TtsService.name);
  private ttsGrpcClient: TTSGrpcClient;

  constructor(@Inject('TTS_PACKAGE') private readonly client: ClientGrpc) {}

  onModuleInit() {
    this.ttsGrpcClient = this.client.getService<TTSGrpcClient>('TTSService');
    this.logger.log('TTS gRPC client initialized successfully.');
  }

  async synthesize(
    text: string,
    voice = 'lahgtna-v3-balanced',
    speed = 1.0,
    pitch = 1.0,
  ): Promise<SynthesizeResponse> {
    this.logger.log(
      `Sending text to TTS gRPC service ("${text.substring(0, 50)}...", voice: ${voice}, speed: ${speed})...`,
    );

    try {
      const response = await firstValueFrom(
        this.ttsGrpcClient.synthesize({
          text,
          voice,
          speed,
          pitch,
        }),
      );

      this.logger.log(
        `TTS Synthesis completed in ${response.inference_time_seconds}s (audio bytes: ${response.audio_data.length})`,
      );
      return response;
    } catch (error) {
      this.logger.error(`TTS gRPC call failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
