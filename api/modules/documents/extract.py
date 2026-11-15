"""Чтение форматов без восстановления исходной вёрстки и без OCR."""
import csv
import io
from pathlib import Path
from docx import Document as WordDocument
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader

FORMATS = {"txt", "md", "csv", "pdf", "docx"}


def decode_text(data: bytes) -> tuple[str, list[str]]:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16"), []
    try:
        return data.decode("utf-8-sig"), []
    except UnicodeDecodeError:
        return data.decode("cp1251"), ["Текст прочитан как Windows-1251. Проверьте корректность символов."]


def extract(path: Path, format: str) -> tuple[str, list[dict], list[str]]:
    tables, warnings = [], []
    if format in {"txt", "md", "csv"}:
        text, warnings = decode_text(path.read_bytes())
        if "\x00" in text:
            raise ValueError("Вместо текста обнаружены двоичные данные.")
        if format == "csv":
            try:
                dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
            except csv.Error:
                dialect = csv.excel
                warnings.append("Разделитель CSV не определён; использована запятая.")
            rows = list(csv.reader(io.StringIO(text, newline=""), dialect=dialect, strict=True))
            tables.append({"name": "Таблица 1", "rows": rows})
            text = "\n".join("\t".join(row) for row in rows)
    elif format == "pdf":
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("PDF защищён паролем. Загрузите незашифрованную копию.")
        pages = []
        has_text = False
        for number, page in enumerate(reader.pages, 1):
            try:
                content = page.extract_text() or ""
            except Exception:
                content = ""
                warnings.append(f"Не удалось прочитать страницу {number}.")
            if not content.strip():
                warnings.append(f"Страница {number}: текст не найден; для скана может потребоваться OCR.")
            else:
                has_text = True
            pages.append(f"--- Страница {number} ---\n{content}")
        text = "\n\n".join(pages)
        warnings.append("Вёрстка и таблицы PDF не восстанавливаются; проверьте порядок текста.")
        if not has_text:
            raise ValueError("В PDF нет доступного текста. Для сканированного документа требуется OCR.")
    elif format == "docx":
        doc = WordDocument(path)
        parts = []
        for block in doc.iter_inner_content():
            if isinstance(block, Paragraph):
                parts.append(block.text)
            elif isinstance(block, Table):
                rows = [[cell.text for cell in row.cells] for row in block.rows]
                tables.append({"name": f"Таблица {len(tables) + 1}", "rows": rows})
                parts.append("\n".join("\t".join(row) for row in rows))
        text = "\n".join(parts)
        warnings.append("Прочитаны абзацы и таблицы основного текста; изображения, колонтитулы и вложенные таблицы не извлекаются.")
    else:
        raise ValueError("Формат не поддерживается.")
    if not text.strip():
        warnings.append("Документ не содержит непустого текста.")
    return text, tables, warnings
