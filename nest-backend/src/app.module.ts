import { Module } from '@nestjs/common';
import { PipelineModule } from './pipeline/pipeline.module';
import { SttModule } from './stt/stt.module';
import { TtsModule } from './tts/tts.module';

@Module({
  imports: [SttModule, TtsModule, PipelineModule],
  controllers: [],
  providers: [],
})
export class AppModule { }
