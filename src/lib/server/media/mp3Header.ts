import fs from 'node:fs/promises';

/**
 * ID3v2 헤더 자체의 크기(태그 크기 필드 앞부분). 이만큼만 먼저 읽어 본문
 * 크기를 계산한 뒤, 그 위치부터 다시 읽는다 — 앨범 아트가 든 ID3 태그는
 * 수백 KB일 수 있어 앞부분을 통째로 읽으면 낭비다.
 */
const ID3_HEADER_SIZE = 10;

/** 오디오 시작점부터 첫 프레임 동기 워드를 찾을 때까지 읽는 크기. */
const AUDIO_SCAN_SIZE = 4096;

/**
 * 첫 프레임 시작부터 Xing/VBRI/Info 태그를 찾는 범위.
 * Xing/Info는 프레임 헤더+side info 뒤(MPEG 버전·채널에 따라 4+9~4+32),
 * VBRI는 오프셋 36에 온다 — 200바이트면 모두 덮는다.
 */
const TAG_SEARCH_WINDOW = 200;

/** ID3v2 footer 존재 플래그(헤더 5번 바이트, bit 4). */
const ID3_FOOTER_FLAG = 0x10;

async function readAt(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/**
 * ID3v2 태그가 있으면 그 전체 크기(헤더+본문+footer)를, 없으면 null을
 * 돌려준다. 크기 필드는 syncsafe 정수(바이트마다 상위 1비트를 버린 7비트)다.
 */
function id3v2TotalSize(header: Buffer): number | null {
  if (header.length < ID3_HEADER_SIZE || header.toString('ascii', 0, 3) !== 'ID3') return null;

  const flags = header[5];
  const hasFooter = (flags & ID3_FOOTER_FLAG) !== 0;
  const size =
    ((header[6] & 0x7f) << 21) |
    ((header[7] & 0x7f) << 14) |
    ((header[8] & 0x7f) << 7) |
    (header[9] & 0x7f);

  return ID3_HEADER_SIZE + size + (hasFooter ? ID3_HEADER_SIZE : 0);
}

/** buf 안에서 MPEG 오디오 프레임 동기 워드(0xFF 다음 바이트 상위 3비트가 111)를 찾는다. */
function findFrameSync(buf: Buffer): number {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) return i;
  }
  return -1;
}

/**
 * mp3가 가변 비트레이트(VBR)인지 판정한다.
 *
 * 첫 오디오 프레임 근처에 LAME/Xing 계열 인코더가 남기는 태그를 본다:
 * - `Xing`/`VBRI` → VBR
 * - `Info` → CBR (LAME이 CBR 파일에 쓰는 태그)
 * - 태그 없음 → CBR로 본다. 태그 없는 VBR은 구형 인코더에서나 나오고,
 *   그 경우를 가려낼 신호가 이 파일 안에 없다 — 이 판정의 한계다.
 */
export async function isVbrMp3(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r');
  try {
    const id3Header = await readAt(handle, 0, ID3_HEADER_SIZE);
    const id3Size = id3v2TotalSize(id3Header);
    const audioStart = id3Size ?? 0;

    const scanned = await readAt(handle, audioStart, AUDIO_SCAN_SIZE);
    const frameOffset = findFrameSync(scanned);
    if (frameOffset === -1) return false;

    const window = scanned
      .subarray(frameOffset, frameOffset + TAG_SEARCH_WINDOW)
      .toString('latin1');
    return window.includes('Xing') || window.includes('VBRI');
  } finally {
    await handle.close();
  }
}
