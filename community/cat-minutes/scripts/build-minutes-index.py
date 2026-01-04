#!/usr/bin/env python3
import csv
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree

MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]

MONTH_INDEX = {month.lower(): i for i, month in enumerate(MONTHS, start=1)}
FILENAME_PATTERN = re.compile(
    r"^(%s)Minutes(\d{4})$|^(%s)(\d{4})Minutes$|^(%s)(\d{4})$"
    % ("|".join(MONTHS), "|".join(MONTHS), "|".join(MONTHS))
)


def extract_docx_text(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            with archive.open("word/document.xml") as doc:
                xml_content = doc.read()
    except Exception:
        return ""

    try:
        root = ElementTree.fromstring(xml_content)
    except ElementTree.ParseError:
        return ""

    parts = []
    for node in root.iter():
        if node.tag.endswith("}t") and node.text:
            parts.append(node.text)

    return " ".join(parts)


def extract_doc_text(path: Path) -> str:
    try:
        result = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", str(path)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except Exception:
        return ""

    return result.stdout or ""


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def parse_minutes(folder: Path):
    items = []
    for entry in folder.iterdir():
        if entry.name.startswith(".") or entry.is_dir():
            continue
        if entry.parent.name == "bundles" or entry.suffix.lower() not in {".doc", ".docx"}:
            continue

        match = FILENAME_PATTERN.match(entry.stem)
        if not match:
            continue

        year = int(next(group for group in match.groups() if group and group.isdigit()))
        month = next(
            group for group in match.groups() if group and group in MONTHS
        )

        if entry.suffix.lower() == ".docx":
            raw_text = extract_docx_text(entry)
        else:
            raw_text = extract_doc_text(entry)

        text = normalize_text(raw_text)

        items.append(
            {
                "title": f"{month} {year} minutes",
                "year": year,
                "month": month,
                "month_num": MONTH_INDEX[month.lower()],
                "filename": entry.name,
                "path": f"/community/cat-minutes/{entry.name}",
                "ext": entry.suffix.lstrip(".").upper() or "DOC",
                "text": text,
            }
        )

    items.sort(key=lambda x: (-x["year"], x["month_num"], x["filename"].lower()))
    return items


def main():
    folder = Path(__file__).resolve().parents[1]
    items = parse_minutes(folder)

    search_path = folder / "index-search.json"
    search_path.write_text(json.dumps(items, indent=2))

    summary_items = [
        {key: item[key] for key in ("title", "year", "month", "month_num", "filename", "path", "ext")}
        for item in items
    ]
    summary_path = folder / "index.json"
    summary_path.write_text(json.dumps(summary_items, indent=2))

    csv_path = folder / "index.csv"
    with csv_path.open("w", newline="") as csvfile:
        writer = csv.DictWriter(
            csvfile,
            fieldnames=["title", "year", "month", "month_num", "filename", "path", "ext"],
        )
        writer.writeheader()
        for item in summary_items:
            writer.writerow(item)

    bundles_dir = folder / "bundles"
    bundles_dir.mkdir(exist_ok=True)
    bundles_by_year = {}
    for item in items:
        bundles_by_year.setdefault(item["year"], []).append(item["filename"])

    for year, filenames in bundles_by_year.items():
        zip_path = bundles_dir / f"CAT-minutes-{year}.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for filename in filenames:
                archive.write(folder / filename, arcname=filename)

    print(f"Wrote {search_path} ({len(items)} entries)")
    print(f"Wrote {summary_path} and {csv_path}")
    print(f"Wrote {len(bundles_by_year)} bundle(s) in {bundles_dir}")


if __name__ == "__main__":
    main()
