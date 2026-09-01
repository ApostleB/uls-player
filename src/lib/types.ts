export interface FileEntry {
  /** original 항목에만 있다. 변환본은 포맷 이름이 곧 확장자다. */
  ext?: string;
  bytes: number;
}

export interface Bookmark {
  id: string;
  atSec: number;
  /** null이면 지점 북마크, 값이 있으면 구간 북마크 */
  endSec: number | null;
  note: string;
}

export interface Recording {
  id: string;
  title: string;
  description: string;
  tags: string[];
  recordedAt: string;
  durationSec: number;
  sourceName: string;
  appleAutoTitle: string | null;
  /** 키는 'original' 또는 포맷 이름('mp3','wav') */
  files: Record<string, FileEntry>;
  bookmarks: Bookmark[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RecordingsFile {
  version: 1;
  recordings: Recording[];
}

export type TagMode = 'and' | 'or';

export interface Filter {
  q: string;
  tags: string[];
  tagMode: TagMode;
  /** YYYY-MM-DD, 포함 */
  from: string;
  /** YYYY-MM-DD, 포함 */
  to: string;
}

export interface FormatSpec {
  name: string;
  ext: string;
  codec: string;
  bitrate: string | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface AppConfig {
  dataDir: string;
  mediaDir: string;
  formats: FormatSpec[];
  convertConcurrency: number;
  waveformPeaks: number;
  maxUploadMb: number;
}

export interface ScanItem {
  sourcePath: string;
  sourceName: string;
  title: string;
  appleAutoTitle: string | null;
  recordedAt: string;
  durationSec: number;
  ext: string;
  bytes: number;
  audioStreamIndex: number;
  duplicate: boolean;
  /** 읽을 수 없는 파일이면 사유가 들어가고 나머지 필드는 신뢰할 수 없다 */
  error: string | null;
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobItem {
  id: string;
  recordingId: string;
  sourcePath: string;
  title: string;
  status: JobStatus;
  /** 포맷 이름 → 상태 */
  formats: Record<string, JobStatus>;
  error: string | null;
}

export interface JobsFile {
  version: 1;
  items: JobItem[];
}
