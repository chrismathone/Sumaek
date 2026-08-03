# HWP v5 본문 텍스트 추출기.
#
# 용도: 교육부 고시문(교육과정 별책 등) 같은 공공 HWP 문서에서 본문을 뽑아
# TypeScript 쪽 파서(collect-curriculum.mts)가 구조화할 수 있게 한다.
# extract.py(PDF 기하 덤프)와 같은 관례 — 파이썬은 바이너리 해석만 하고,
# 해석(성취기준 구조화)은 TS가 한다.
#
# HWP v5 = CFB(OLE) 컨테이너.
#   FileHeader[36] bit0     : 본문 압축 여부
#   BodyText/Section{n}     : zlib(raw, -15) 레코드 열
#   레코드 헤더 4바이트     : tag(10) | level(10) | size(12), size=0xFFF면 확장 4바이트
#   HWPTAG_PARA_TEXT = 67   : UTF-16LE 문단 텍스트 (인라인 컨트롤 16바이트 스킵)
#
# 의존성: olefile (python -m pip install olefile)
#
# 사용:
#   python hwp-text.py --hwp 문서.hwp -o out.txt
#   python hwp-text.py --zip 고시.zip --member 별책8 -o out.txt -e extracted.hwp
#     (zip 항목명은 CP949 — cp437 오해석을 되돌려 --member 부분 일치로 찾는다)
import argparse
import re
import sys
import zipfile
import zlib
from pathlib import Path

try:
    import olefile
except ImportError:
    print(
        "olefile이 없습니다. 설치: python -m pip install olefile",
        file=sys.stderr,
    )
    sys.exit(2)

# 인라인 컨트롤(뒤에 12바이트 추가 데이터가 붙어 총 16바이트) — HWP 5.0 명세
INLINE_CONTROLS = {1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23}
HWPTAG_PARA_TEXT = 67


def decode_zip_name(name: str) -> str:
    """zip 항목명 CP949 복원 — 파이썬 zipfile은 cp437로 잘못 해석한다"""
    try:
        return name.encode("cp437").decode("cp949")
    except UnicodeError:
        return name


def extract_member(zip_path: Path, member_substr: str, out_hwp: Path) -> str:
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            real = decode_zip_name(info.filename)
            if member_substr in real:
                out_hwp.write_bytes(zf.read(info))
                return real
    raise SystemExit(f"zip 안에서 '{member_substr}'를 찾지 못했습니다")


def hwp_text(hwp_path: Path) -> str:
    ole = olefile.OleFileIO(str(hwp_path))
    header = ole.openstream("FileHeader").read()
    if not header.startswith(b"HWP Document File"):
        raise SystemExit("HWP v5 서명이 아닙니다 (hwpx라면 zip으로 여세요)")
    compressed = bool(header[36] & 0x01)

    sections = sorted(
        (e for e in ole.listdir() if e[0] == "BodyText"),
        key=lambda e: int(re.sub(r"\D", "", e[1]) or 0),
    )
    parts: list[str] = []
    for entry in sections:
        data = ole.openstream(entry).read()
        if compressed:
            data = zlib.decompress(data, -15)
        pos = 0
        while pos + 4 <= len(data):
            head = int.from_bytes(data[pos : pos + 4], "little")
            tag = head & 0x3FF
            size = (head >> 20) & 0xFFF
            pos += 4
            if size == 0xFFF:
                size = int.from_bytes(data[pos : pos + 4], "little")
                pos += 4
            if tag == HWPTAG_PARA_TEXT:
                raw = data[pos : pos + size]
                chars: list[str] = []
                i = 0
                while i + 1 < len(raw):
                    code = int.from_bytes(raw[i : i + 2], "little")
                    if 0xD800 <= code <= 0xDFFF:
                        # 미처리 인라인 잔재로 나온 홀로 서로게이트 — 버린다
                        i += 2
                        continue
                    if code in (10, 13):
                        chars.append("\n")
                        i += 2
                    elif code >= 32:
                        chars.append(chr(code))
                        i += 2
                    else:
                        i += 16 if code in INLINE_CONTROLS else 2
                parts.append("".join(chars))
            pos += size
    ole.close()
    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="HWP v5 본문 텍스트 추출")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--hwp", type=Path, help="HWP 파일 직접 지정")
    source.add_argument("--zip", type=Path, help="zip에서 꺼내기")
    parser.add_argument("--member", help="--zip일 때 항목명 부분 일치 (CP949 복원 후)")
    parser.add_argument("-o", "--out", type=Path, required=True, help="텍스트 출력 경로")
    parser.add_argument(
        "-e", "--emit-hwp", type=Path, help="--zip일 때 추출한 HWP 저장 경로"
    )
    args = parser.parse_args()

    if args.zip:
        if not args.member or not args.emit_hwp:
            raise SystemExit("--zip에는 --member와 --emit-hwp가 필요합니다")
        real_name = extract_member(args.zip, args.member, args.emit_hwp)
        print(f"zip 항목: {real_name}", file=sys.stderr)
        hwp_path = args.emit_hwp
    else:
        hwp_path = args.hwp

    text = hwp_text(hwp_path)
    args.out.write_text(text, encoding="utf-8")
    print(f"본문 {len(text):,}자 -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
