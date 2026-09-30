import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('빈 env에서 기본값을 만든다', () => {
    const cfg = loadConfig({});
    expect(cfg.formats.map((f) => f.name)).toEqual(['mp3', 'wav']);
    expect(cfg.convertConcurrency).toBe(4);
    expect(cfg.waveformPeaks).toBe(2000);
    expect(cfg.maxUploadMb).toBe(500);
    expect(cfg.maxUploadTotalMb).toBe(4096);
  });

  it('MAX_UPLOAD_TOTAL_MB를 env로 덮어쓴다', () => {
    const cfg = loadConfig({ MAX_UPLOAD_TOTAL_MB: '1024' });
    expect(cfg.maxUploadTotalMb).toBe(1024);
  });

  it('OUTPUT_FORMATS에 없는 포맷은 만들지 않는다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: 'mp3' });
    expect(cfg.formats).toHaveLength(1);
    expect(cfg.formats[0].name).toBe('mp3');
  });

  it('포맷별 파라미터를 env로 덮어쓴다', () => {
    const cfg = loadConfig({
      OUTPUT_FORMATS: 'mp3,wav',
      MP3_BITRATE: '320k',
      WAV_CHANNELS: '2',
      WAV_SAMPLE_RATE: '48000'
    });
    const mp3 = cfg.formats.find((f) => f.name === 'mp3')!;
    const wav = cfg.formats.find((f) => f.name === 'wav')!;
    expect(mp3.bitrate).toBe('320k');
    expect(wav.channels).toBe(2);
    expect(wav.sampleRate).toBe(48000);
  });

  it('공백과 빈 항목을 걸러낸다', () => {
    const cfg = loadConfig({ OUTPUT_FORMATS: ' mp3 , , wav ' });
    expect(cfg.formats.map((f) => f.name)).toEqual(['mp3', 'wav']);
  });

  it('알 수 없는 포맷은 거부한다', () => {
    expect(() => loadConfig({ OUTPUT_FORMATS: 'mp3,flac' })).toThrow(/flac/);
  });

  it('mp3 인코더 레벨은 지정하지 않으면 null이다 — 지금과 같은 인코딩', () => {
    const cfg = loadConfig({});
    for (const f of cfg.formats) expect(f.compressionLevel).toBeNull();
  });

  it('MP3_COMPRESSION_LEVEL을 읽는다', () => {
    const mp3 = loadConfig({ MP3_COMPRESSION_LEVEL: '7' }).formats.find((f) => f.name === 'mp3')!;
    expect(mp3.compressionLevel).toBe(7);
  });

  it('빈 MP3_COMPRESSION_LEVEL은 지정하지 않은 것으로 본다', () => {
    const mp3 = loadConfig({ MP3_COMPRESSION_LEVEL: '  ' }).formats.find((f) => f.name === 'mp3')!;
    expect(mp3.compressionLevel).toBeNull();
  });

  // 조용히 무시하면 사용자는 설정이 먹은 줄 믿고 느린 변환을 계속 본다.
  it.each(['10', '-1', 'abc', '3.5'])('MP3_COMPRESSION_LEVEL=%s는 기동 시 거부한다', (v) => {
    expect(() => loadConfig({ MP3_COMPRESSION_LEVEL: v })).toThrow(/0~9/);
  });
});
