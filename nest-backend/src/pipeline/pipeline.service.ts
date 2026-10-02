import { Injectable, Logger } from '@nestjs/common';
import { SttService } from '../stt/stt.service';
import { TtsService } from '../tts/tts.service';
import { AssistantService } from './assistant.service';

export interface PipelineResult {
  transcription: string;
  processedText: string;
  audioBase64: string;
  audioFormat: string;
  sampleRate: number;
  status: 'ok' | 'empty' | 'error';
  message?: string;
  timings: {
    sttSeconds: number;
    llmSeconds: number;
    ttsSeconds: number;
    totalSeconds: number;
  };
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly sttService: SttService,
    private readonly ttsService: TtsService,
    private readonly assistantService: AssistantService,
  ) {}

  /**
   * Conversational reply step. Uses an optional LLM when configured,
   * otherwise a local voice-oriented assistant with short session memory.
   */
  async processWithLlm(
    transcribedText: string,
    sessionId = 'default',
  ): Promise<string> {
    const result = await this.assistantService.generateReply(
      transcribedText,
      sessionId,
    );
    this.logger.log(
      `[Assistant:${result.source}] "${transcribedText}" -> "${result.reply}"`,
    );
    return result.reply;
  }

  /**
   * Main Voice Pipeline Execution:
   * Frontend Audio -> STT (gRPC) -> Transcription -> Assistant -> TTS (gRPC)
   */
  async runPipeline(
    audioBuffer: Buffer,
    audioFormat = 'wav',
    voice = 'lahgtna-v3-balanced',
    speed = 1.0,
    sessionId = 'default',
  ): Promise<PipelineResult> {
    const totalStart = Date.now();
    this.logger.log(
      `Starting Voice Pipeline. Audio size: ${audioBuffer.length} bytes, format: ${audioFormat}`,
    );

    const emptyResult = (
      sttDuration: number,
      status: PipelineResult['status'],
      message?: string,
    ): PipelineResult => ({
      transcription: '',
      processedText: '',
      audioBase64: '',
      audioFormat: 'wav',
      sampleRate: 24000,
      status,
      message,
      timings: {
        sttSeconds: sttDuration,
        llmSeconds: 0,
        ttsSeconds: 0,
        totalSeconds: (Date.now() - totalStart) / 1000,
      },
    });

    const sttStart = Date.now();
    const sttResult = await this.sttService.transcribe(audioBuffer, audioFormat);
    const sttDuration = (Date.now() - sttStart) / 1000;
    const transcription = (sttResult.text || '').trim();

    if (!transcription) {
      this.logger.warn('STT returned empty transcription. Skipping TTS.');
      return emptyResult(
        sttDuration,
        'empty',
        'لم يتم التعرف على كلام واضح.',
      );
    }

    const llmStart = Date.now();
    const processedText = await this.processWithLlm(transcription, sessionId);
    const llmDuration = (Date.now() - llmStart) / 1000;

    if (!processedText.trim()) {
      this.logger.warn('Assistant returned an empty reply. Skipping TTS.');
      return {
        transcription,
        processedText: '',
        audioBase64: '',
        audioFormat: 'wav',
        sampleRate: 24000,
        status: 'empty',
        message: 'تعذر تجهيز رد صوتي مناسب.',
        timings: {
          sttSeconds: parseFloat(sttDuration.toFixed(3)),
          llmSeconds: parseFloat(llmDuration.toFixed(3)),
          ttsSeconds: 0,
          totalSeconds: parseFloat(((Date.now() - totalStart) / 1000).toFixed(3)),
        },
      };
    }

    const ttsStart = Date.now();
    const ttsResult = await this.ttsService.synthesize(
      processedText,
      voice,
      speed,
    );
    const ttsDuration = (Date.now() - ttsStart) / 1000;

    if (!ttsResult?.audio_data || ttsResult.status === 'error') {
      throw new Error(
        ttsResult?.error_message || 'TTS returned no audio data.',
      );
    }

    const audioBase64 = Buffer.from(ttsResult.audio_data).toString('base64');
    const totalSeconds = (Date.now() - totalStart) / 1000;

    this.logger.log(
      `Pipeline completed in ${totalSeconds.toFixed(2)}s (STT: ${sttDuration.toFixed(2)}s, Assistant: ${llmDuration.toFixed(2)}s, TTS: ${ttsDuration.toFixed(2)}s)`,
    );

    return {
      transcription,
      processedText,
      audioBase64,
      audioFormat: ttsResult.audio_format || 'wav',
      sampleRate: ttsResult.sample_rate || 24000,
      status: 'ok',
      timings: {
        sttSeconds: parseFloat(sttDuration.toFixed(3)),
        llmSeconds: parseFloat(llmDuration.toFixed(3)),
        ttsSeconds: parseFloat(ttsDuration.toFixed(3)),
        totalSeconds: parseFloat(totalSeconds.toFixed(3)),
      },
    };
  }
}
