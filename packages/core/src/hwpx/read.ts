/**
 * 최소 ZIP 리더 — 로컬 파일 헤더를 직접 걸어서 읽는다.
 *
 * fflate 의 `unzipSync` 로는 확인할 수 없는 것을 보기 위해 있다: 엔트리의
 * **순서**, 압축 **방식**, extra field 유무. HWPX 는 mimetype 이 첫 엔트리이면서
 * 무압축이어야 한다는 OCF 규약을 지켜야 하므로 이 세 가지가 곧 계약이고,
 * 산출물 형식 검증(C-14 ①)이 확인해야 하는 대상이다.
 */

const LOCAL_FILE_HEADER_SIG = 0x04034b50;

export interface ZipEntry {
  readonly name: string;
  /** 0 = STORED(무압축), 8 = DEFLATE */
  readonly method: number;
  /** general purpose bit flag — 3번 비트가 서면 크기가 헤더에 없다(data descriptor) */
  readonly flags: number;
  readonly extraLength: number;
  /** 압축된 바이트 (STORED 면 원본 그대로) */
  readonly data: Uint8Array;
}

/** 로컬 파일 헤더를 순서대로 훑는다. 중앙 디렉터리는 보지 않는다. */
export function readZipEntries(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];

  let offset = 0;
  while (
    offset + 30 <= zip.length &&
    view.getUint32(offset, true) === LOCAL_FILE_HEADER_SIG
  ) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: decoder.decode(zip.subarray(nameStart, nameStart + nameLength)),
      method,
      flags,
      extraLength,
      data: zip.subarray(dataStart, dataStart + compressedSize),
    });
    offset = dataStart + compressedSize;
  }

  return entries;
}
