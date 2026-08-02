"""교재 PDF의 한 쪽(또는 그 일부)을 이미지로 뽑는다. **눈으로 대조하기 위해서다.**

이 도구가 있어야 하는 이유:

  이 반입 작업에서 옳았던 판단은 전부 해당 쪽을 그려서 눈으로 본 것이었고,
  틀렸던 판단은 전부 코드와 좌표만 보고 추론한 것이었다. 「ª는 배치상 8일
  것 같다」는 추론이고, 「지면에 2⁸이라고 찍혀 있다」는 사실이다. 해독표에
  값을 넣기 전에 반드시 이걸로 지면을 열어 볼 것.

  extract.py는 좌표만 뽑는다(해석하지 않는다). 그림은 여기서만 나온다.

쓰는 법:

  # 한 쪽 통째로
  python packages/ingest/python/render-page.py "교재.pdf" 12 -o p12.png

  # 좌표로 잘라서 (extract.py 덤프의 x0 y0 x1 y1 을 그대로 넣으면 된다)
  python packages/ingest/python/render-page.py "교재.pdf" 12 \
      --clip 315 275 580 350 -o q0164.png

쪽 번호는 **1부터**다 — extract.py 덤프의 `page` 값과 같다.

주의: 뽑은 이미지에는 구매자 워터마크가 그대로 찍힌다. 저장소에 커밋하지 말 것
(`.gitignore`가 `*.png`를 막지 않는다). 다 보고 나면 지운다.

PyMuPDF만 있으면 된다:  pip install pymupdf
"""

from __future__ import annotations

import argparse
import sys

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - 실행 환경 안내
    sys.exit("PyMuPDF가 필요합니다:  python -m pip install pymupdf")


def main() -> None:
    ap = argparse.ArgumentParser(description="교재 PDF의 한 쪽을 이미지로")
    ap.add_argument("pdf")
    ap.add_argument("page", type=int, help="쪽 번호 (1-based, extract.py 덤프의 page와 같다)")
    ap.add_argument("-o", "--out", required=True, help="저장할 PNG 경로")
    ap.add_argument(
        "--clip",
        nargs=4,
        type=float,
        metavar=("X0", "Y0", "X1", "Y1"),
        help="잘라 낼 영역. 덤프의 좌표를 그대로 넣는다",
    )
    ap.add_argument("--dpi", type=int, default=300, help="기본 300 — 위첨자를 읽으려면 이 정도는 필요하다")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    if not (1 <= args.page <= doc.page_count):
        sys.exit(f"쪽 번호가 범위를 벗어났습니다: {args.page} (문서 {doc.page_count}쪽)")

    page = doc[args.page - 1]
    clip = fitz.Rect(*args.clip) if args.clip else None
    page.get_pixmap(clip=clip, dpi=args.dpi).save(args.out)
    doc.close()

    where = f" {tuple(args.clip)}" if args.clip else ""
    print(f"p.{args.page}{where} → {args.out} ({args.dpi}dpi)")


if __name__ == "__main__":
    main()
