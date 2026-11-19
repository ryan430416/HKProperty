#!/usr/bin/env python3
"""Extract plain text from a PDF (one page section at a time)."""
from __future__ import annotations

import argparse
import sys

import fitz


def main() -> int:
    parser = argparse.ArgumentParser(description='Extract PDF text with PyMuPDF')
    parser.add_argument('pdf')
    parser.add_argument('--max-pages', type=int, default=0, help='0 = all pages')
    parser.add_argument('--start', type=int, default=1, help='1-based start page')
    args = parser.parse_args()

    doc = fitz.open(args.pdf)
    start = max(1, args.start)
    end = doc.page_count if args.max_pages <= 0 else min(doc.page_count, start + args.max_pages - 1)
    print(f'pages {doc.page_count}; showing {start}-{end}', file=sys.stderr)
    for i in range(start - 1, end):
        print(f'===PAGE {i + 1}===')
        print(doc[i].get_text('text'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
