#!/usr/bin/env python3
"""Parse 社團器材使用紀錄 PDF into structured JSON."""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict

import fitz

DATE_RE = re.compile(r'\d{2,3}/\d{1,2}/\d{1,2}')
SEQ_RE = re.compile(r'^\d+$')
HEADER_NOISE = {
    '序', '借用日期', '歸還日期', '用途', '借用人姓名',
    '借用之實際', '借用人單位職稱/', '借用人單位職稱'
}


def spans(page):
    rows = []
    for block in page.get_text('dict')['blocks']:
        if block.get('type') != 0:
            continue
        for line in block.get('lines', []):
            text = ''.join(span['text'] for span in line.get('spans', [])).strip()
            if not text:
                continue
            x0, y0, x1, y1 = line['bbox']
            rows.append({
                'text': text,
                'x': x0,
                'y': y0,
                'yc': (y0 + y1) / 2,
            })
    return rows


def parse_header(texts: list[str]) -> dict | None:
    joined = '\n'.join(texts)
    name = re.search(r'財產名稱：\s*(.+)', joined)
    buy = re.search(r'購買日期：\s*(.+)', joined)
    club = re.search(r'購置(?:社團|單位)：\s*(.*)', joined)
    pid = re.search(r'財產編號：\s*(.+)', joined)
    if not (name and pid):
        return None
    return {
        'name': name.group(1).strip(),
        'purchaseDate': (buy.group(1).strip() if buy else ''),
        'club': (club.group(1).strip() if club else ''),
        'propertyId': re.sub(r'\s+', '', pid.group(1)),
        'rows': [],
    }


def join_person_fragments(parts: list[str]) -> str:
    out = ''
    for part in parts:
        text = part.strip()
        if not text:
            continue
        if not out:
            out = text
            continue
        if text.startswith('/') or out.endswith('/'):
            out = out.rstrip('/') + '/' + text.lstrip('/')
        elif text.startswith('(') or text.startswith('（'):
            out += text
        else:
            out += text
    return out


def split_person(raw: str) -> tuple[str, str, str]:
    text = re.sub(r'\s+', '', raw or '')
    text = text.strip('/')
    parts = [p for p in text.split('/') if p]
    if len(parts) >= 3:
        return parts[0], '/'.join(parts[1:-1]), parts[-1]
    if len(parts) == 2:
        # unit / title+name without final slash — treat second as title if long, else name
        return parts[0], parts[1], ''
    if len(parts) == 1:
        return '', '', parts[0]
    return '', '', ''


def normalize_date(value: str) -> str:
    m = DATE_RE.search(value or '')
    if not m:
        return ''
    y, mo, d = m.group(0).split('/')
    return f'{int(y):03d}/{int(mo):02d}/{int(d):02d}'


def parse_row_band(seq_text: str, items: list[dict]) -> dict:
    texts = [i['text'] for i in sorted(items, key=lambda r: (r['yc'], r['x'])) if i['text'] not in HEADER_NOISE]
    # dates in reading order
    dates = []
    for text in texts:
        for match in DATE_RE.findall(text):
            dates.append(normalize_date(match))
    borrow = dates[0] if dates else ''
    returned = dates[1] if len(dates) > 1 else ''

    purpose_parts: list[str] = []
    unit_title_parts: list[str] = []
    name_parts: list[str] = []

    for item in sorted(items, key=lambda r: (r['yc'], r['x'])):
        text = item['text']
        if text in HEADER_NOISE or SEQ_RE.match(text):
            continue
        # Some pages put 姓名 in a right sub-column (~457) separate from 單位職稱 (~393).
        if item['x'] >= 440:
            name_parts.append(text)
            continue
        if item['x'] >= 390:
            unit_title_parts.append(text)
            continue
        # borrow-date-only cells
        if item['x'] < 200 and DATE_RE.fullmatch(text.replace(' ', '')):
            continue
        # merged return+purpose(+unit/title) cells around x~210
        if item['x'] < 390:
            rest = text
            while True:
                m = DATE_RE.match(rest.strip())
                if not m:
                    break
                rest = rest.strip()[m.end():].strip()
            if not rest:
                continue
            slash = rest.find('/')
            if slash > 0:
                left, right = rest[:slash], rest[slash:]
                m2 = re.search(r'^(.*?)([\u4e00-\u9fffA-Za-z0-9（）()]{2,20})$', left)
                if m2 and m2.group(1):
                    purpose_parts.append(m2.group(1).strip())
                    unit_title_parts.append(m2.group(2) + right)
                else:
                    unit_title_parts.append(rest)
            else:
                purpose_parts.append(rest)

    purpose = re.sub(r'\s+', '', ''.join(purpose_parts))
    unit_title = join_person_fragments(unit_title_parts)
    name_only = re.sub(r'\s+', '', ''.join(name_parts))
    if name_only:
        person_raw = f'{unit_title.rstrip("/")}/{name_only}' if unit_title else name_only
    else:
        person_raw = unit_title
    unit, title, name = split_person(person_raw)
    if name_only and not name:
        name = name_only
        # unit_title may be unit/title already
        parts = [p for p in unit_title.split('/') if p]
        if len(parts) >= 2:
            unit, title = parts[0], '/'.join(parts[1:])
        elif len(parts) == 1:
            unit, title = parts[0], ''

    return {
        'seq': int(seq_text),
        'borrowedAt': borrow,
        'returnedAt': returned,
        'purpose': purpose,
        'unit': unit,
        'title': title,
        'name': name,
        'personRaw': person_raw,
    }


def parse_page(page) -> tuple[dict | None, list[dict]]:
    items = spans(page)
    # Include slightly lower lines: some pages put 財產編號 below y=170.
    header = parse_header([i['text'] for i in items if i['y'] < 210])
    body = [i for i in items if i['y'] >= 200]
    seq_items = [i for i in body if SEQ_RE.match(i['text']) and i['x'] < 120]
    seq_items.sort(key=lambda r: r['yc'])
    rows = []
    for idx, seq in enumerate(seq_items):
        y0 = seq['yc'] - 10
        y1 = (seq_items[idx + 1]['yc'] - 10) if idx + 1 < len(seq_items) else seq['yc'] + 48
        band = [i for i in body if y0 <= i['yc'] < y1]
        rows.append(parse_row_band(seq['text'], band))
    return header, rows


def parse_pdf(path: str) -> dict:
    doc = fitz.open(path)
    assets = []
    current = None
    for page in doc:
        header, rows = parse_page(page)
        if header:
            current = header
            assets.append(current)
        if current is None:
            continue
        current['rows'].extend(rows)

    # quality flags
    for asset in assets:
        bad = [r for r in asset['rows'] if not r['returnedAt'] or not r['purpose'] or not r['name']]
        asset['incompleteCount'] = len(bad)
    return {'source': path, 'pageCount': doc.page_count, 'assets': assets}


def main() -> int:
    parser = argparse.ArgumentParser(description='Parse 器材使用紀錄 PDF')
    parser.add_argument('pdf')
    parser.add_argument('--json', dest='json_path', default='')
    parser.add_argument('--summary', action='store_true')
    args = parser.parse_args()

    data = parse_pdf(args.pdf)
    total_rows = sum(len(a['rows']) for a in data['assets'])
    incomplete = sum(a.get('incompleteCount', 0) for a in data['assets'])
    print(
        f"assets={len(data['assets'])} rows={total_rows} incomplete={incomplete} pages={data['pageCount']}",
        file=sys.stderr,
    )
    for asset in data['assets']:
        sample = asset['rows'][:2]
        print(
            f"- {asset['propertyId']} {asset['name']} rows={len(asset['rows'])} incomplete={asset['incompleteCount']} sample={sample}",
            file=sys.stderr,
        )
    if args.json_path:
        with open(args.json_path, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        print(args.json_path)
    else:
        json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
        print()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
