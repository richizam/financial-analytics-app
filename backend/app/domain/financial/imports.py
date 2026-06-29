from __future__ import annotations

import re
from typing import Any, Callable

from .aggregation import aggregate_account_period_balances
from .cache import AnalysisCache
from .normalization import (
    AUTO_MAPPING_CONFIDENCE,
    mapping_confidence,
    mapping_is_complete,
    mapping_response,
    normalize_journal_csv,
    normalize_opening_balances_csv,
    opening_year_from_filename,
    period_from_filename,
)
from .serialization import entries_to_canonical_csv, opening_balances_to_canonical_csv
from backend.app.storage import VALID_RUC


MappingProvider = Callable[[str, str], dict[str, Any]]

_FILENAME_RE = re.compile(r"^(\d{6}|saldos_iniciales_\d{4})\.csv$", re.IGNORECASE)
MAX_CSV_UPLOAD_BYTES = 2_000_000


class CsvImporter:
    """Orchestrates a CSV upload: validate, normalize, resolve column mapping
    (heuristic → optional AI fallback → user confirmation), then persist via the
    structured storage path when available or canonical-CSV fallback otherwise.
    """

    def __init__(self, storage: Any, cache: AnalysisCache) -> None:
        self.storage = storage
        self.cache = cache

    def upload_csv(
        self,
        ruc: str,
        filename: str,
        content: str,
        mapping: dict[str, Any] | None = None,
        mapping_provider: MappingProvider | None = None,
    ) -> dict[str, Any]:
        ruc = (ruc or "").strip()
        if not VALID_RUC.fullmatch(ruc):
            return {"ok": False, "error": "RUC invalido (debe tener 13 digitos)"}
        if not _FILENAME_RE.fullmatch(filename):
            return {"ok": False, "error": "Nombre invalido. Usa YYYYMM.csv o saldos_iniciales_YYYY.csv"}
        if len((content or "").encode("utf-8")) > MAX_CSV_UPLOAD_BYTES:
            return {"ok": False, "error": "CSV demasiado grande. El limite es 2 MB por archivo."}

        if period_from_filename(filename):
            return self._upload_journal_csv(ruc, filename, content, mapping, mapping_provider)
        if opening_year_from_filename(filename):
            return self._upload_opening_balances_csv(ruc, filename, content, mapping)
        return {"ok": False, "error": "Nombre invalido. Usa YYYYMM.csv o saldos_iniciales_YYYY.csv"}

    def _upload_journal_csv(
        self,
        ruc: str,
        filename: str,
        content: str,
        mapping: dict[str, Any] | None,
        mapping_provider: MappingProvider | None,
    ) -> dict[str, Any]:
        proposal = mapping_response(filename, content, mapping, "confirmed" if mapping else "heuristic")
        selected_mapping = proposal["proposal"]["mapping"]
        selected_provider = proposal["provider"]
        selected_confidence = float(proposal["proposal"].get("confidence", mapping_confidence(selected_mapping)))

        if mapping is None and (not mapping_is_complete(selected_mapping) or selected_confidence < AUTO_MAPPING_CONFIDENCE):
            if mapping_provider is not None:
                ai_proposal = mapping_provider(filename, content)
                ai_mapping = ai_proposal.get("proposal", {}).get("mapping", {})
                ai_confidence = float(ai_proposal.get("proposal", {}).get("confidence", mapping_confidence(ai_mapping)))
                if mapping_is_complete(ai_mapping) and ai_confidence >= AUTO_MAPPING_CONFIDENCE:
                    selected_mapping = ai_mapping
                    selected_provider = str(ai_proposal.get("provider", "xai"))
                    selected_confidence = ai_confidence
                else:
                    return self._mapping_required_response(filename, ai_proposal)
            else:
                return self._mapping_required_response(filename, proposal)

        normalized = normalize_journal_csv(
            content,
            filename,
            selected_mapping,
            selected_provider,
            selected_confidence,
        )
        if normalized["errors"]:
            return {
                "ok": False,
                "filename": filename,
                "error": "No se pudo importar el CSV. Revisa el mapeo o el formato de las filas.",
                "errors": normalized["errors"][:20],
                "warnings": normalized["warnings"],
                "file_profile": normalized["profile"],
                "proposal": {
                    "mapping": normalized["mapping"],
                    "confidence": normalized["confidence"],
                    "warnings": normalized["warnings"],
                    "requires_user_confirmation": True,
                    "detected_format": {},
                },
            }

        try:
            self._persist_journal(ruc, filename, content, normalized)
            self.cache.invalidate(ruc)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {
            "ok": True,
            "filename": filename,
            "normalized": True,
            "rowCount": len(normalized["entries"]),
            "provider": normalized["provider"],
            "confidence": normalized["confidence"],
            "warnings": normalized["warnings"],
        }

    def _upload_opening_balances_csv(
        self,
        ruc: str,
        filename: str,
        content: str,
        mapping: dict[str, Any] | None,
    ) -> dict[str, Any]:
        normalized = normalize_opening_balances_csv(content, filename, mapping)
        if normalized["errors"] or normalized["warnings"]:
            return {
                "ok": False,
                "filename": filename,
                "error": "No se pudieron importar los saldos iniciales. Revisa las columnas de cuenta y saldo.",
                "errors": normalized["errors"][:20],
                "warnings": normalized["warnings"],
                "file_profile": normalized["profile"],
            }
        try:
            self._persist_opening_balances(ruc, filename, content, normalized)
            self.cache.invalidate(ruc)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {
            "ok": True,
            "filename": filename,
            "normalized": True,
            "rowCount": len(normalized["balances"]),
            "provider": normalized["provider"],
            "confidence": normalized["confidence"],
            "warnings": normalized["warnings"],
        }

    def _persist_journal(self, ruc: str, filename: str, content: str, normalized: dict[str, Any]) -> None:
        importer = getattr(self.storage, "upsert_journal_import", None)
        if callable(importer):
            entries = normalized["entries"]
            importer(
                ruc,
                filename,
                content,
                entries,
                aggregate_account_period_balances(entries),
                self._import_meta(normalized, len(entries)),
            )
        else:
            self.storage.upsert(ruc, filename, entries_to_canonical_csv(normalized["entries"]))

    def _persist_opening_balances(self, ruc: str, filename: str, content: str, normalized: dict[str, Any]) -> None:
        importer = getattr(self.storage, "upsert_opening_balance_import", None)
        if callable(importer):
            balances = normalized["balances"]
            importer(
                ruc,
                filename,
                content,
                balances,
                self._import_meta(normalized, len(balances)),
            )
        else:
            self.storage.upsert(ruc, filename, opening_balances_to_canonical_csv(normalized["balances"]))

    @staticmethod
    def _import_meta(normalized: dict[str, Any], row_count: int) -> dict[str, Any]:
        return {
            "provider": normalized["provider"],
            "mapping": normalized["mapping"],
            "confidence": normalized["confidence"],
            "warnings": normalized["warnings"],
            "row_count": row_count,
            "error_count": len(normalized["errors"]),
        }

    @staticmethod
    def _mapping_required_response(filename: str, proposal: dict[str, Any]) -> dict[str, Any]:
        return {
            "ok": False,
            "filename": filename,
            "mappingRequired": True,
            "error": "Confirma el mapeo de columnas para importar este CSV.",
            "provider": proposal.get("provider", "heuristic"),
            "file_profile": proposal.get("file_profile"),
            "proposal": proposal.get("proposal"),
            "warnings": proposal.get("warnings", []),
        }
