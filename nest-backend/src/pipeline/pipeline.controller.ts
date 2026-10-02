import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PipelineService, PipelineResult } from './pipeline.service';
import { SttService } from '../stt/stt.service';
import { TtsService } from '../tts/tts.service';

class ProcessBase64Dto {
  audioBase64: string;
  format?: string;
  voice?: string;
  speed?: number;
  sessionId?: string;
}

class TestTtsDto {
  text: string;
  voice?: string;
  speed?: number;
}

@Controller('pipeline')
export class PipelineController {
  private readonly logger = new Logger(PipelineController.name);

  constructor(
    private readonly pipelineService: PipelineService,
    private readonly sttService: SttService,
    private readonly ttsService: TtsService,
  ) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'Voice Pipeline NestJS Gateway',
      architecture: 'Frontend -> NestJS -> STT (gRPC) -> [LLM] -> TTS (gRPC) -> Frontend',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Main pipeline endpoint receiving recorded audio file as multipart/form-data.
   */
  @Post('process')
  @UseInterceptors(FileInterceptor('audio'))
  async processAudioFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('voice') voice?: string,
    @Body('speed') speed?: string,
    @Body('sessionId') sessionId?: string,
  ): Promise<PipelineResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Audio file is required in "audio" field.');
    }

    const parsedSpeed = speed ? parseFloat(speed) : 1.0;
    const format = file.originalname?.split('.').pop() || 'wav';

    this.logger.log(
      `Received audio file: ${file.originalname || 'blob'}, size: ${file.buffer.length} bytes, mimetype: ${file.mimetype}`,
    );

    return this.pipelineService.runPipeline(
      file.buffer,
      format,
      voice || 'lahgtna-v3-balanced',
      parsedSpeed,
      sessionId || 'default',
    );
  }

  /**
   * Main pipeline endpoint receiving base64 audio payload (convenient for web clients).
   */
  @Post('process-base64')
  async processBase64(
    @Body() dto: ProcessBase64Dto,
  ): Promise<PipelineResult> {
    if (!dto.audioBase64) {
      throw new BadRequestException('audioBase64 is required.');
    }

    // Strip possible data URI header (e.g. "data:audio/wav;base64,")
    const cleanBase64 = dto.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (buffer.length === 0) {
      throw new BadRequestException('Decoded audio buffer is empty.');
    }

    return this.pipelineService.runPipeline(
      buffer,
      dto.format || 'wav',
      dto.voice || 'lahgtna-v3-balanced',
      dto.speed || 1.0,
      dto.sessionId || 'default',
    );
  }

  /**
   * Direct STT test endpoint.
   */
  @Post('stt-only')
  @UseInterceptors(FileInterceptor('audio'))
  async testSttOnly(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Audio file is required.');
    }
    const format = file.originalname?.split('.').pop() || 'wav';
    return this.sttService.transcribe(file.buffer, format);
  }

  /**
   * Direct TTS test endpoint.
   */
  @Post('tts-only')
  async testTtsOnly(@Body() dto: TestTtsDto) {
    if (!dto.text) {
      throw new BadRequestException('Text is required.');
    }
    const result = await this.ttsService.synthesize(
      dto.text,
      dto.voice || 'lahgtna-v3-balanced',
      dto.speed || 1.0,
    );

    return {
      text: dto.text,
      audioBase64: Buffer.from(result.audio_data).toString('base64'),
      audioFormat: result.audio_format,
      sampleRate: result.sample_rate,
      inferenceTimeSeconds: result.inference_time_seconds,
    };
  }
}
