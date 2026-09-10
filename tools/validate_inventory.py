# -*- coding: utf-8 -*-
"""Validate converted inventory JSON."""

import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "inventory.json"


def roc_to_iso_from_raw_digits(digits: str) -> str:
    if len(digits) == 6:
        year, month, day = int(digits[:2]), int(digits[2:4]), int(digits[4:6])
    elif len(digits) == 7:
        year, month, day = int(digits[:3]), int(digits[3:5]), int(digits[5:7])
    else:
        raise ValueError(digits)
    return date(year + 1911, month, day).isoformat()


def main() -> None:
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    items = payload["items"]
    ids = [item["propertyId"] for item in items]
    dupes = [pid for pid, count in Counter(ids).items() if count > 1]
    sci = [pid for pid in ids if "e" in pid.lower() or "E" in pid]
    non_str = [pid for pid in ids if not isinstance(pid, str)]
    bad_date = [item for item in items if item["purchaseDate"] and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", item["purchaseDate"])]
    sample = next(item for item in items if item["propertyId"] == "820091001")

    report = {
        "count": len(items),
        "uniqueIds": len(set(ids)),
        "duplicateIds": dupes,
        "scientificIds": sci,
        "nonStringIds": non_str,
        "badDates": len(bad_date),
        "sample830621": sample["purchaseDate"],
        "expected1994": "1994-06-21",
        "emptyNames": sum(1 for item in items if not item["name"]),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    assert report["count"] == 390
    assert report["uniqueIds"] == 390
    assert not dupes
    assert not sci
    assert not non_str
    assert not bad_date
    assert sample["purchaseDate"] == "1994-06-21"
    print("validation ok")


if __name__ == "__main__":
    main()
