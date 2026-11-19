---
name: pdf-read
description: >-
  Extracts text, tables, and structured fields from PDF files with PyMuPDF
  (pymupdf). Use when the user asks to read, parse, inspect, or import data from
  a PDF, especially Traditional Chinese forms such as 器材使用紀錄.
---

# PDF Read

## When to use

- User attaches or names a `.pdf` and wants contents, tables, or fields extracted
- Need to import PDF rows into an app/database
- DOMMatrix / browser PDF tools fail; prefer local Python + PyMuPDF

## Prerequisites

```bash
pip show pymupdf || pip install pymupdf
```

## Quick extract (text)

```bash
python scripts/extract_text.py "PATH/TO/file.pdf"
```

## Structured 器材使用紀錄 table

For official club equipment usage log PDFs (header: 財產名稱／購買日期／購置社團／財產編號; columns: 序／借用日期／歸還日期／用途／單位職稱姓名):

```bash
python scripts/parse_usage_log.py "PATH/TO/114年度器材使用紀錄.pdf" --json out.json
```

Output JSON shape:

```json
{
  "assets": [
    {
      "name": "平板電腦",
      "purchaseDate": "111/09/30",
      "club": "學生會",
      "propertyId": "1110136001",
      "rows": [
        {
          "seq": 1,
          "borrowedAt": "114/01/01",
          "returnedAt": "114/01/03",
          "purpose": "宣傳影片播放展示使用",
          "unit": "學生會",
          "title": "公關部部員",
          "name": "黃薪達"
        }
      ]
    }
  ]
}
```

## Agent workflow

1. Run the appropriate script with absolute paths
2. Do not dump entire multi-page raw text into chat; summarize counts and show a few sample rows
3. When importing, match `propertyId` to existing assets; skip or report unmatched IDs
4. Person cell is `單位/職稱/姓名` (slashes); wrap lines must be joined before splitting
