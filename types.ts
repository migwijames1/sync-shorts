
export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
}

export interface MediaAsset {
  type: 'image' | 'video';
  url: string;
  hasAudio: boolean;
  startTime?: number; // For video segments
  endTime?: number;   // For video segments
}

export interface SubtitleSegment {
  text: string;
  start: number;
  end: number;
}

export interface GeneratedContent {
  assets: MediaAsset[];
  metadata: YouTubeMetadata;
  subtitles: SubtitleSegment[];
}

export enum GenerationStep {
  IDLE = 'IDLE',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT',
  TRANSCRIBING = 'TRANSCRIBING',
  PROFILING_VOICE = 'PROFILING_VOICE',
  GENERATING_IMAGES = 'GENERATING_IMAGES',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface AppState {
  topic: string;
  script: string;
  voiceSample: string | null;
  userFullAudio: string | null;
  userImages: string[];
  userVideos: string[]; // Base64 or Blob URLs
  youtubeVoiceLink: string;
  step: GenerationStep;
  progressMessage: string;
  result: GeneratedContent | null;
}
