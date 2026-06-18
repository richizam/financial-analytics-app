from __future__ import annotations

import csv
import io
import json
import re
from decimal import Decimal, InvalidOperation
from typing import Any


TARGET_SCHEMA: dict[str, list[str]] = {
    "required_fields": [
        "transaction_date",
        "description",
        "debit",
        "credit",
        "account_code",
    ],
    "optional_fields": [
        "amount",
        "account_name",
        "journal_entry",
        "entry_type",
        "currency",
        "cost_center",
        "document_number",
    ],
}

_DATE_PATTERNS = [
    re.compile(r"^\d{4}-\d{2}-\d{2}$"),
    re.compile(r"^\d{2}/\d{2}/\d{4}$"),
    re.compile(r"^\d{2}-\d{2}-\d{4}$"),
]
_ACCOUNT_RE = re.compile(r"^\d+(?:[.-]\d+)*$")


def _read_rows(content: str, max_rows: int = 50) -> tuple[str, list[list[str]]]:
    sample = content[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","

    reader = csv.reader(io.StringIO(content.replace("\r\n", "\n").replace("\r", "\n")), delimiter=delimiter)
    rows: list[list[str]] = []
    for row in reader:
        rows.append([field.strip() for field in row])
        if len(rows) >= max_rows:
            break
    return delimiter, rows


def _is_money(value: str) -> bool:
    normalized = value.strip().replace("$", "").replace(" ", "")
    if "," in normalized and "." in normalized:
        normalized = normalized.replace(",", "")
    elif "," in normalized:
        normalized = normalized.replace(",", ".")
    try:
        Decimal(normalized)
    except InvalidOperation:
        return False
    return True


def _detected_type(values: list[str]) -> str:
    nonblank = [value for value in values if value]
    if not nonblank:
        return "empty"

    date_hits = sum(any(pattern.fullmatch(value) for pattern in _DATE_PATTERNS) for value in nonblank)
    money_hits = sum(_is_money(value) for value in nonblank)
    account_hits = sum(bool(_ACCOUNT_RE.fullmatch(value)) for value in nonblank)

    if date_hits / len(nonblank) >= 0.7:
        return "date"
    if account_hits / len(nonblank) >= 0.7 and any("." in value or "-" in value for value in nonblank):
        return "account_code"
    if money_hits / len(nonblank) >= 0.7:
        return "money"
    if account_hits / len(nonblank) >= 0.7:
        return "number"
    return "text"


def _mask_example(value: str, detected_type: str) -> str:
    clean = value.strip()
    if detected_type in {"date", "money", "account_code", "number", "empty"}:
        return clean[:32]

    clean = re.sub(r"\b\d{4,}\b", "***", clean)
    clean = re.sub(r"[\w.+-]+@[\w-]+\.[\w.-]+", "***", clean)
    if len(clean) > 28:
        return f"{clean[:25]}***"
    return clean


def build_csv_profile(filename: str, content: str) -> dict[str, Any]:
    delimiter, rows = _read_rows(content)
    headers = rows[0] if rows else []
    data_rows = rows[1:]
    column_count = len(headers)

    columns: list[dict[str, Any]] = []
    for index, header in enumerate(headers):
        values = [row[index] for row in data_rows if len(row) > index]
        detected = _detected_type(values)
        examples: list[str] = []
        for value in values:
            if not value:
                continue
            masked = _mask_example(value, detected)
            if masked not in examples:
                examples.append(masked)
            if len(examples) >= 5:
                break
        columns.append(
            {
                "name": header,
                "detected_type": detected,
                "examples": examples,
            }
        )

    return {
        "filename": filename,
        "delimiter": delimiter,
        "encoding": "utf-8-sig",
        "sampled_rows": len(data_rows),
        "column_count": column_count,
        "columns": columns,
    }


def _normalize_name(name: str) -> str:
    value = name.lower().strip()
    value = value.replace("_", " ").replace("-", " ")
    value = re.sub(r"\s+", " ", value)
    replacements = {
        "\u00e1": "a",
        "\u00e9": "e",
        "\u00ed": "i",
        "\u00f3": "o",
        "\u00fa": "u",
        "\u00f1": "n",
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)
    return value


def heuristic_mapping(profile: dict[str, Any]) -> dict[str, Any]:
    columns = [column["name"] for column in profile.get("columns", [])]
    normalized = {_normalize_name(column): column for column in columns}

    candidates: dict[str, list[str]] = {
        "transaction_date": ["fecha", "date", "transaction date"],
        "description": ["descripcion", "concepto", "detalle", "glosa", "description"],
        "debit": ["debe", "debito", "debit"],
        "credit": ["haber", "credito", "credit"],
        "amount": ["monto", "amount", "valor", "importe"],
        "account_code": ["codcuenta", "cod cuenta", "codigo cuenta", "cuenta", "account code"],
        "account_name": ["nombrecuenta", "nombre cuenta", "account name"],
        "journal_entry": ["asiento", "journal entry", "comprobante"],
        "entry_type": ["tipo", "type"],
        "cost_center": ["centrocosto", "centro costo", "cost center"],
        "document_number": ["documento", "document number", "numero documento", "factura"],
        "currency": ["moneda", "currency"],
    }

    mapping: dict[str, str | None] = {}
    for target, names in candidates.items():
        mapping[target] = None
        for name in names:
            if name in normalized:
                mapping[target] = normalized[name]
                break

    required = TARGET_SCHEMA["required_fields"]
    matched_required = sum(1 for field in required if mapping.get(field))
    warnings: list[str] = []
    if mapping.get("amount") and not (mapping.get("debit") and mapping.get("credit")):
        warnings.append("Amount column detected without a clear debit/credit split.")
    for field in required:
        if not mapping.get(field):
            warnings.append(f"Required field not confidently detected: {field}.")

    return {
        "mapping": mapping,
        "detected_format": {
            "date_format": None,
            "decimal_separator": ".",
            "thousands_separator": None,
            "negative_number_format": "-123.45",
        },
        "confidence": round(matched_required / len(required), 2),
        "warnings": warnings,
        "requires_user_confirmation": True,
    }


def safe_json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
