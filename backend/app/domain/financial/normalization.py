from __future__ import annotations

import csv
import io
import re
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from backend.app.domain.ai.csv_profile import TARGET_SCHEMA, build_csv_profile


AUTO_MAPPING_CONFIDENCE = 0.85

TARGET_FIELDS = list(dict.fromkeys([*TARGET_SCHEMA["required_fields"], *TARGET_SCHEMA["optional_fields"]]))
REQUIRED_BASE_FIELDS = ("transaction_date", "description", "account_code")

FIELD_CANDIDATES: dict[str, tuple[str, ...]] = {
    "transaction_date": (
        "fecha",
        "dia",
        "fechacontable",
        "fechatransaccion",
        "fechamovimiento",
        "date",
        "transactiondate",
        "postingdate",
    ),
    "description": ("descripcion", "detalle", "concepto", "glosa", "memo", "description", "detail"),
    "debit": ("debe", "debito", "cargo", "dr", "debit", "debitamount"),
    "credit": ("haber", "credito", "abono", "cr", "credit", "creditamount"),
    "amount": ("monto", "valor", "importe", "amount", "total", "saldo"),
    "account_code": (
        "codcuenta",
        "codigocuenta",
        "cuenta",
        "accountcode",
        "account",
        "accountnumber",
        "ledgeraccount",
    ),
    "account_name": ("nombrecuenta", "nombre", "cuentanombre", "accountname", "accountdescription"),
    "journal_entry": ("asiento", "comprobante", "numeroasiento", "numasiento", "journalentry", "voucher"),
    "entry_type": ("tipo", "tipocomprobante", "clase", "type", "entrytype"),
    "currency": ("moneda", "divisa", "currency"),
    "cost_center": ("centrocosto", "centrodecosto", "ccosto", "costcenter", "department"),
    "document_number": ("documento", "numerodocumento", "factura", "referencia", "documentnumber", "invoice"),
}

OPENING_BALANCE_CANDIDATES: dict[str, tuple[str, ...]] = {
    "account_code": ("codcuenta", "codigocuenta", "cuenta", "accountcode", "account"),
    "account_name": ("nombrecuenta", "nombre", "cuentanombre", "accountname", "accountdescription"),
    "opening_balance": ("saldoinicial", "saldo", "balance", "openingbalance", "initialbalance"),
    "balance_type": ("tipo", "naturaleza", "debitoacredito", "nature", "type"),
}


def period_from_filename(filename: str) -> str | None:
    match = re.fullmatch(r"(?P<period>\d{6})\.csv", filename or "", re.IGNORECASE)
    if not match:
        return None
    period = match.group("period")
    month = int(period[4:6])
    return period if 1 <= month <= 12 else None


def opening_year_from_filename(filename: str) -> int | None:
    match = re.fullmatch(r"saldos_iniciales_(?P<year>\d{4})\.csv", filename or "", re.IGNORECASE)
    return int(match.group("year")) if match else None


def read_csv_rows(content: str) -> tuple[str, list[str], list[dict[str, str]]]:
    normalized = (content or "").replace("\r\n", "\n").replace("\r", "\n")
    sample = normalized[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","

    reader = csv.DictReader(io.StringIO(normalized), delimiter=delimiter)
    headers = [_clean_header(header) for header in (reader.fieldnames or [])]
    rows: list[dict[str, str]] = []
    for raw in reader:
        row: dict[str, str] = {}
        for key, value in raw.items():
            if key is None:
                continue
            row[_clean_header(key)] = str(value or "").strip()
        rows.append(row)
    return delimiter, headers, rows


def infer_mapping(profile: dict[str, Any]) -> dict[str, Any]:
    columns = [str(column.get("name", "")) for column in profile.get("columns", [])]
    normalized_columns = {_normalize_column_name(column): column for column in columns}
    mapping: dict[str, str | None] = {field: None for field in TARGET_FIELDS}

    for target, candidates in FIELD_CANDIDATES.items():
        for candidate in candidates:
            source = normalized_columns.get(candidate)
            if source:
                mapping[target] = source
                break

    confidence = mapping_confidence(mapping)
    warnings = _mapping_warnings(mapping)
    return {
        "mapping": mapping,
        "detected_format": {
            "date_format": None,
            "decimal_separator": None,
            "thousands_separator": None,
            "negative_number_format": "-123.45",
        },
        "confidence": confidence,
        "warnings": warnings,
        "requires_user_confirmation": confidence < AUTO_MAPPING_CONFIDENCE or bool(warnings),
    }


def sanitize_mapping(mapping: dict[str, Any], profile: dict[str, Any]) -> dict[str, str | None]:
    valid_columns = {str(column.get("name", "")) for column in profile.get("columns", [])}
    source_mapping = mapping.get("mapping") if isinstance(mapping.get("mapping"), dict) else mapping
    sanitized: dict[str, str | None] = {field: None for field in TARGET_FIELDS}
    for field in TARGET_FIELDS:
        value = source_mapping.get(field) if isinstance(source_mapping, dict) else None
        if isinstance(value, str) and value in valid_columns:
            sanitized[field] = value
    return sanitized


def mapping_confidence(mapping: dict[str, str | None]) -> float:
    slots = 4
    hits = sum(1 for field in REQUIRED_BASE_FIELDS if mapping.get(field))
    if mapping.get("debit") and mapping.get("credit"):
        hits += 1
    elif mapping.get("amount"):
        hits += 0.75
    return round(min(hits / slots, 1), 2)


def mapping_is_complete(mapping: dict[str, str | None]) -> bool:
    if any(not mapping.get(field) for field in REQUIRED_BASE_FIELDS):
        return False
    return bool((mapping.get("debit") and mapping.get("credit")) or mapping.get("amount"))


def mapping_response(
    filename: str,
    content: str,
    proposal: dict[str, Any] | None = None,
    provider: str = "heuristic",
) -> dict[str, Any]:
    profile = build_csv_profile(filename, content)
    inferred = infer_mapping(profile)
    if proposal is not None:
        mapping = sanitize_mapping(proposal, profile)
        inferred = {
            "mapping": mapping,
            "detected_format": proposal.get("detected_format", {}) if isinstance(proposal, dict) else {},
            "confidence": mapping_confidence(mapping),
            "warnings": _mapping_warnings(mapping),
            "requires_user_confirmation": not mapping_is_complete(mapping),
        }
    return {
        "provider": provider,
        "file_profile": profile,
        "proposal": inferred,
        "warnings": list(inferred.get("warnings", [])),
    }


def normalize_journal_csv(
    content: str,
    filename: str,
    mapping: dict[str, Any] | None = None,
    provider: str = "heuristic",
    confidence: float | None = None,
) -> dict[str, Any]:
    period = period_from_filename(filename)
    profile = build_csv_profile(filename, content)
    proposal = infer_mapping(profile) if mapping is None else {"mapping": sanitize_mapping(mapping, profile)}
    source_mapping = sanitize_mapping(proposal, profile)
    resolved_confidence = mapping_confidence(source_mapping) if confidence is None else max(0, min(float(confidence), 1))

    warnings = _mapping_warnings(source_mapping)
    if not mapping_is_complete(source_mapping):
        return {
            "entries": [],
            "errors": [{"row": 1, "field": "mapping", "message": "No se pudo resolver el mapeo minimo de columnas."}],
            "warnings": warnings,
            "profile": profile,
            "mapping": source_mapping,
            "confidence": resolved_confidence,
            "provider": provider,
        }

    _, _, rows = read_csv_rows(content)
    entries: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for index, row in enumerate(rows, start=2):
        if _is_blank_row(row):
            continue

        fecha_raw = _row_value(row, source_mapping, "transaction_date")
        fecha = parse_date(fecha_raw)
        cod_cuenta = _row_value(row, source_mapping, "account_code")
        descripcion = _row_value(row, source_mapping, "description")
        if not fecha:
            errors.append({"row": index, "field": "transaction_date", "message": f"Fecha invalida: {fecha_raw}"})
            continue
        if not cod_cuenta:
            errors.append({"row": index, "field": "account_code", "message": "La cuenta contable es obligatoria."})
            continue
        if not descripcion:
            errors.append({"row": index, "field": "description", "message": "La descripcion es obligatoria."})
            continue

        debe, haber = _entry_amounts(row, source_mapping)
        entries.append(
            {
                "fecha": fecha.isoformat(),
                "asiento": _row_value(row, source_mapping, "journal_entry") or f"ROW-{index - 1}",
                "tipo": _row_value(row, source_mapping, "entry_type"),
                "codCuenta": cod_cuenta,
                "nombreCuenta": _row_value(row, source_mapping, "account_name") or cod_cuenta,
                "descripcion": descripcion,
                "debe": debe,
                "haber": haber,
                "centroCosto": _row_value(row, source_mapping, "cost_center"),
                "periodo": period or f"{fecha.year:04d}{fecha.month:02d}",
                "rowNumber": index,
                "documentNumber": _row_value(row, source_mapping, "document_number") or None,
                "currency": _row_value(row, source_mapping, "currency") or None,
                "rawRow": row,
            }
        )

    return {
        "entries": entries,
        "errors": errors,
        "warnings": warnings,
        "profile": profile,
        "mapping": source_mapping,
        "confidence": resolved_confidence,
        "provider": provider,
    }


def normalize_opening_balances_csv(
    content: str,
    filename: str,
    mapping: dict[str, Any] | None = None,
) -> dict[str, Any]:
    year = opening_year_from_filename(filename)
    profile = build_csv_profile(filename, content)
    source_mapping = _opening_balance_mapping(profile, mapping)
    warnings = _opening_mapping_warnings(source_mapping)

    _, _, rows = read_csv_rows(content)
    balances: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for index, row in enumerate(rows, start=2):
        if _is_blank_row(row):
            continue
        cod_cuenta = _row_value(row, source_mapping, "account_code")
        if not cod_cuenta:
            errors.append({"row": index, "field": "account_code", "message": "La cuenta contable es obligatoria."})
            continue
        saldo = parse_money_to_cents(_row_value(row, source_mapping, "opening_balance"))
        tipo = _row_value(row, source_mapping, "balance_type").upper()
        if tipo.startswith("A") or tipo.startswith("C"):
            saldo = -abs(saldo)
        elif tipo.startswith("D"):
            saldo = abs(saldo)

        balances.append(
            {
                "codCuenta": cod_cuenta,
                "nombreCuenta": _row_value(row, source_mapping, "account_name") or cod_cuenta,
                "totalDebe": saldo if saldo > 0 else 0,
                "totalHaber": -saldo if saldo < 0 else 0,
                "saldo": saldo,
                "tipo": tipo,
                "year": year,
                "rowNumber": index,
                "rawRow": row,
            }
        )

    return {
        "balances": balances,
        "errors": errors,
        "warnings": warnings,
        "profile": profile,
        "mapping": source_mapping,
        "confidence": 1 if not warnings else 0.75,
        "provider": "canonical",
    }


def parse_money_to_cents(value: str) -> int:
    raw = str(value or "").strip()
    if not raw:
        return 0
    negative = raw.startswith("-") or (raw.startswith("(") and raw.endswith(")"))
    clean = raw.replace("$", "").replace("USD", "").replace("usd", "")
    clean = clean.replace(" ", "").replace("'", "").strip("()")
    clean = clean.lstrip("+")
    if clean.startswith("-"):
        clean = clean[1:]

    comma_position = clean.rfind(",")
    dot_position = clean.rfind(".")
    if comma_position >= 0 and dot_position >= 0:
        decimal_separator = "," if comma_position > dot_position else "."
        thousands_separator = "." if decimal_separator == "," else ","
        clean = clean.replace(thousands_separator, "")
        clean = clean.replace(decimal_separator, ".")
    elif "," in clean:
        if re.search(r",\d{1,2}$", clean):
            clean = clean.replace(".", "").replace(",", ".")
        else:
            clean = clean.replace(",", "")
    elif clean.count(".") > 1:
        clean = clean.replace(".", "")
    elif re.search(r"\.\d{3}$", clean):
        clean = clean.replace(".", "")

    try:
        amount = Decimal(clean)
    except InvalidOperation:
        return 0
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return -cents if negative else cents


def parse_date(value: str) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"\d{5}", raw):
        return date(1899, 12, 30) + timedelta(days=int(raw))
    raw = raw[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%Y", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _entry_amounts(row: dict[str, str], mapping: dict[str, str | None]) -> tuple[int, int]:
    if mapping.get("amount") and not (mapping.get("debit") and mapping.get("credit")):
        amount = parse_money_to_cents(_row_value(row, mapping, "amount"))
        return (amount, 0) if amount >= 0 else (0, abs(amount))

    debit = parse_money_to_cents(_row_value(row, mapping, "debit"))
    credit = parse_money_to_cents(_row_value(row, mapping, "credit"))
    return abs(debit), abs(credit)


def _opening_balance_mapping(profile: dict[str, Any], mapping: dict[str, Any] | None) -> dict[str, str | None]:
    columns = [str(column.get("name", "")) for column in profile.get("columns", [])]
    valid_columns = set(columns)
    normalized_columns = {_normalize_column_name(column): column for column in columns}
    if mapping:
        source = mapping.get("mapping") if isinstance(mapping.get("mapping"), dict) else mapping
        return {
            field: value if isinstance(value, str) and value in valid_columns else None
            for field, value in source.items()
            if field in OPENING_BALANCE_CANDIDATES
        }

    resolved: dict[str, str | None] = {field: None for field in OPENING_BALANCE_CANDIDATES}
    for field, candidates in OPENING_BALANCE_CANDIDATES.items():
        for candidate in candidates:
            value = normalized_columns.get(candidate)
            if value:
                resolved[field] = value
                break
    return resolved


def _mapping_warnings(mapping: dict[str, str | None]) -> list[str]:
    warnings: list[str] = []
    for field in REQUIRED_BASE_FIELDS:
        if not mapping.get(field):
            warnings.append(f"No se detecto la columna requerida: {field}.")
    if not ((mapping.get("debit") and mapping.get("credit")) or mapping.get("amount")):
        warnings.append("No se detectaron columnas de debe/haber ni una columna de monto.")
    return warnings


def _opening_mapping_warnings(mapping: dict[str, str | None]) -> list[str]:
    warnings: list[str] = []
    for field in ("account_code", "opening_balance"):
        if not mapping.get(field):
            warnings.append(f"No se detecto la columna requerida: {field}.")
    return warnings


def _row_value(row: dict[str, str], mapping: dict[str, str | None], field: str) -> str:
    source = mapping.get(field)
    return str(row.get(source, "")).strip() if source else ""


def _is_blank_row(row: dict[str, str]) -> bool:
    return not row or all(not str(value).strip() for value in row.values())


def _clean_header(header: str) -> str:
    return str(header or "").strip().lstrip("\ufeff")


def _normalize_column_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    normalized = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]", "", normalized)
