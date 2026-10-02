import { Observable } from 'rxjs';

export interface SynthesizeRequest {
  text: string;
  voice?: string;
  speed?: number;
  pitch?: number;
}

export interface SynthesizeResponse {
  audio_data: Buffer | Uint8Array;
  sample_rate: number;
  audio_format: string;
  inference_time_seconds: number;
  status: string;
  error_message?: string;
}

export interface TTSGrpcClient {
  synthesize(request: SynthesizeRequest): Observable<SynthesizeResponse>;
}
