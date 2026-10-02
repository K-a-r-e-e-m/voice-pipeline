import { Observable } from 'rxjs';

export interface AudioRequest {
  audio_data: Buffer | Uint8Array;
  audio_format?: string;
  sample_rate?: number;
}

export interface TranscriptionResponse {
  text: string;
  duration_seconds: number;
  inference_time_seconds: number;
  rtf: number;
  status: string;
  error_message?: string;
}

export interface STTGrpcClient {
  transcribe(request: AudioRequest): Observable<TranscriptionResponse>;
}
