import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { AssistantService } from './assistant.service';
import { SttModule } from '../stt/stt.module';
import { TtsModule } from '../tts/tts.module';

@Module({
  imports: [SttModule, TtsModule],
  controllers: [PipelineController],
  providers: [PipelineService, AssistantService],
  exports: [PipelineService],
})
export class PipelineModule {}
