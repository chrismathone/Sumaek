"""PDF → 기하 덤프(JSON). **해석하지 않는다.**

이 단계가 하는 일은 "종이에 무엇이 어디에 있었나"를 그대로 옮기는 것뿐이다.
문항을 나누는 것도, 수식을 푸는 것도, 선택지를 묶는 것도 전부 TypeScript
쪽(packages/ingest/src)에서 한다.

경계를 여기 두는 이유:
  - 해석에는 테스트가 필요하다. 저장소의 테스트·계약·뮤테이션 검증은 전부
    TS에 있다. 파이썬으로 넘어가는 순간 그 그물 밖이다.
  - 원문(raw_source)은 불변이어야 한다(원칙 2O). 추출기가 수식을 "고쳐서"
    넘기면 원문이 사라진다. 여기서는 PDF가 준 문자열을 그대로 싣는다.

PyMuPDF만 있으면 된다:  pip install pymupdf
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - 실행 환경 안내
    sys.exit("PyMuPDF가 필요합니다:  python -m pip install pymupdf")


def dump_page(page: "fitz.Page", index: int) -> dict:
    """한 쪽의 span·벡터도형·이미지를 좌표째로 싣는다."""
    spans = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:  # 0 = 텍스트
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"]
                if not text.strip():
                    continue
                x0, y0, x1, y1 = span["bbox"]
                spans.append(
                    {
                        "text": text,
                        "x0": round(x0, 2),
                        "y0": round(y0, 2),
                        "x1": round(x1, 2),
                        "y1": round(y1, 2),
                        # 폰트 이름은 문항 번호·강조·수식 이탤릭을 가르는 단서다
                        "font": span["font"],
                        "size": round(span["size"], 2),
                        "flags": span["flags"],
                        "color": span["color"],
                    }
                )

    # 벡터 도형 — 개별 path는 수만 개다. 여기서는 bbox만 싣고
    # 「도형 영역」으로 묶는 일은 TS가 한다(묶는 규칙이 교재마다 다르다).
    drawings = []
    for d in page.get_drawings():
        r = d["rect"]
        # 분수 막대는 높이가 **0인** 가로 선분이다. PyMuPDF는 그런 사각형을
        # is_empty로 판정하므로 「비었으면 버린다」로 거르면 2행 분수(110/n)를
        # 알아볼 근거가 통째로 사라진다 — 실제로 그래서 분자·분모가 서로 다른
        # 줄로 흩어졌다. 가로·세로가 **둘 다** 작을 때만 버린다.
        w = r.x1 - r.x0
        h = r.y1 - r.y0
        if w < 0.4 and h < 0.4:
            continue
        drawings.append(
            {
                "x0": round(r.x0, 2),
                "y0": round(r.y0, 2),
                "x1": round(r.x1, 2),
                "y1": round(r.y1, 2),
                "fill": d.get("fill") is not None,
            }
        )

    images = []
    for info in page.get_images(full=True):
        xref = info[0]
        for r in page.get_image_rects(xref):
            images.append(
                {
                    "xref": xref,
                    "x0": round(r.x0, 2),
                    "y0": round(r.y0, 2),
                    "x1": round(r.x1, 2),
                    "y1": round(r.y1, 2),
                }
            )

    return {
        "page": index + 1,
        "width": round(page.rect.width, 2),
        "height": round(page.rect.height, 2),
        "spans": spans,
        "drawings": drawings,
        "images": images,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="교재 PDF → 기하 덤프 JSON")
    ap.add_argument("pdf")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--from", dest="first", type=int, default=1, help="시작 쪽 (1-based, 포함)")
    ap.add_argument("--to", dest="last", type=int, default=0, help="끝 쪽 (포함, 0=끝까지)")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    last = args.last or doc.page_count
    if not (1 <= args.first <= last <= doc.page_count):
        sys.exit(f"쪽 범위가 잘못됐습니다: {args.first}~{last} (문서 {doc.page_count}쪽)")

    with open(args.pdf, "rb") as fh:
        checksum = hashlib.sha256(fh.read()).hexdigest()

    payload = {
        "source": {
            "fileName": args.pdf.replace("\\", "/").rsplit("/", 1)[-1],
            "checksum": checksum,
            "pageCount": doc.page_count,
            "extractedRange": [args.first, last],
        },
        "pages": [dump_page(doc[i], i) for i in range(args.first - 1, last)],
    }
    doc.close()

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    n_spans = sum(len(p["spans"]) for p in payload["pages"])
    print(f"{len(payload['pages'])}쪽 · span {n_spans}개 → {args.out}")


if __name__ == "__main__":
    main()
