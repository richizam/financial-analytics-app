from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Callable

from .accounting import (
    JournalEntry,
    SaldoCuenta,
    analyze_anomalies,
    calcular_metricas,
    calcular_saldos_por_cuenta,
    generar_eri,
    generar_esf,
    parse_multiple_periods_content,
    parse_opening_balances_content,
    year_from_period,
)
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
from backend.app.storage import CsvStorage, VALID_RUC


MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
MappingProvider = Callable[[str, str], dict[str, Any]]


def fmt_periodo(periodo: str) -> str:
    month = int(periodo[4:6])
    return f"{MONTHS[month - 1]} {periodo[:4]}"


def period_days(periodos: list[str]) -> int:
    if len(periodos) == 1:
        return 30
    if len(periodos) <= 3:
        return 90
    if len(periodos) <= 6:
        return 180
    return 365


class FinancialService:
    def __init__(self, storage: CsvStorage) -> None:
        self.storage = storage

    def for_workspace(self, workspace_id: str) -> "FinancialService":
        return FinancialService(self.storage.for_workspace(workspace_id))

    def get_available_rucs(self) -> list[str]:
        return self.storage.list_rucs()

    def get_all_periods(self, rucs: list[str]) -> dict[str, list[str]]:
        return {ruc: self.storage.list_periods(ruc) for ruc in rucs}

    def _period_contents(self, ruc: str, periodos: list[str]) -> list[dict[str, str]]:
        contents: list[dict[str, str]] = []
        for periodo in sorted(periodos):
            content = self.storage.read(ruc, f"{periodo}.csv")
            if content is not None:
                contents.append({"periodo": periodo, "content": content})
        return contents

    def _entries_for_periods(self, ruc: str, periodos: list[str]) -> list[JournalEntry]:
        sorted_periods = sorted(periodos)
        getter = getattr(self.storage, "get_journal_entries", None)
        if callable(getter):
            entries, found_periods = getter(ruc, sorted_periods)
            missing_periods = [period for period in sorted_periods if period not in found_periods]
            if not missing_periods:
                return entries
            raw_entries = parse_multiple_periods_content(self._period_contents(ruc, missing_periods))["entries"]
            return [*entries, *raw_entries]

        contents = self._period_contents(ruc, sorted_periods)
        return parse_multiple_periods_content(contents)["entries"]

    def _opening_balances(self, ruc: str, year: int) -> dict[str, SaldoCuenta]:
        getter = getattr(self.storage, "get_opening_balances", None)
        if callable(getter):
            opening = getter(ruc, year)
            if opening is not None:
                return opening

        content = self.storage.read(ruc, f"saldos_iniciales_{year}.csv")
        return parse_opening_balances_content(content) if content else {}

    def _sector_for_ruc(self, ruc: str) -> str:
        config = self.get_company_config(ruc)
        sector = str((config or {}).get("sector", "comercial"))
        return sector if sector in {"comercial", "servicios", "industrial", "construccion", "otro"} else "comercial"

    def get_dashboard_data(self, ruc: str, periodos: list[str]) -> dict[str, Any] | None:
        if not periodos:
            return None

        sorted_periods = sorted(periodos)
        cache_key = self._period_key(sorted_periods)
        cached = self._get_analysis_cache(ruc, "dashboard", cache_key)
        if cached is not None:
            return cached

        year = year_from_period(sorted_periods[0])
        entries = self._entries_for_periods(ruc, sorted_periods)
        periodos_leidos = sorted({str(entry.get("periodo")) for entry in entries if str(entry.get("periodo")) in sorted_periods})
        opening = self._opening_balances(ruc, year)

        saldos_esf = calcular_saldos_por_cuenta(entries, opening)
        saldos_eri = calcular_saldos_por_cuenta(entries)
        esf = generar_esf(saldos_esf)
        eri = generar_eri(saldos_eri)
        metricas = calcular_metricas(esf, eri, self._sector_for_ruc(ruc), period_days(sorted_periods))

        monthly_chart: list[dict[str, Any]] = []
        for periodo in sorted_periods:
            period_entries = [entry for entry in entries if entry.get("periodo") == periodo]
            if not period_entries:
                continue
            month_saldos = calcular_saldos_por_cuenta(period_entries)
            month_eri = generar_eri(month_saldos)
            monthly_chart.append(
                {
                    "periodo": periodo,
                    "label": fmt_periodo(periodo),
                    "ingresos": month_eri["ingresos"]["total"],
                    "costoVentas": month_eri["costoVentas"]["total"],
                    "utilidadBruta": month_eri["utilidadBruta"],
                    "utilidadNeta": month_eri["utilidadNeta"],
                }
            )

        result = {
            "esf": esf,
            "eri": eri,
            "metricas": metricas,
            "monthlyChart": monthly_chart,
            "periodosLeidos": periodos_leidos,
        }
        self._set_analysis_cache(ruc, "dashboard", cache_key, result)
        return result

    def get_mayor_page_data(
        self,
        ruc: str,
        periodos: list[str],
        cod_cuenta: str | None,
    ) -> dict[str, Any]:
        if not periodos:
            return {"cuentas": [], "mayor": None, "selectedCuenta": None}

        sorted_periods = sorted(periodos)
        year = year_from_period(sorted_periods[0])
        entries = self._entries_for_periods(ruc, sorted_periods)
        opening = self._opening_balances(ruc, year)
        return self._build_mayor_response(entries, opening, cod_cuenta)

    def get_mayor_completo_data(self, ruc: str, periodos: list[str]) -> list[dict[str, Any]]:
        if not periodos:
            return []

        sorted_periods = sorted(periodos)
        year = year_from_period(sorted_periods[0])
        entries = self._entries_for_periods(ruc, sorted_periods)
        opening = self._opening_balances(ruc, year)
        cuenta_map = self._cuenta_map(entries, opening)
        return [self._build_mayor(entries, opening, cod, cuenta_map[cod]) for cod in sorted(cuenta_map)]

    def _cuenta_map(
        self,
        entries: list[JournalEntry],
        opening: dict[str, SaldoCuenta],
    ) -> dict[str, str]:
        cuenta_map: dict[str, str] = {}
        for entry in entries:
            cuenta_map[entry["codCuenta"]] = entry["nombreCuenta"]
        for cod, saldo in opening.items():
            cuenta_map.setdefault(cod, saldo["nombreCuenta"])
        return cuenta_map

    def _build_mayor_response(
        self,
        entries: list[JournalEntry],
        opening: dict[str, SaldoCuenta],
        cod_cuenta: str | None,
    ) -> dict[str, Any]:
        cuenta_map = self._cuenta_map(entries, opening)
        cuentas = [
            {"codCuenta": cod, "nombreCuenta": nombre}
            for cod, nombre in sorted(cuenta_map.items())
        ]
        selected = cod_cuenta if cod_cuenta and cod_cuenta in cuenta_map else (cuentas[0]["codCuenta"] if cuentas else None)
        if selected is None:
            return {"cuentas": cuentas, "mayor": None, "selectedCuenta": None}
        return {
            "cuentas": cuentas,
            "mayor": self._build_mayor(entries, opening, selected, cuenta_map[selected]),
            "selectedCuenta": selected,
        }

    def _build_mayor(
        self,
        entries: list[JournalEntry],
        opening: dict[str, SaldoCuenta],
        cod: str,
        nombre: str,
    ) -> dict[str, Any]:
        saldo_inicial = int(opening.get(cod, {}).get("saldo", 0))
        account_entries = sorted(
            [entry for entry in entries if entry["codCuenta"] == cod],
            key=lambda entry: (entry["fecha"], entry["asiento"]),
        )
        saldo_acumulado = saldo_inicial
        total_debe = 0
        total_haber = 0
        mayor_entries: list[dict[str, Any]] = []
        for entry in account_entries:
            total_debe += int(entry["debe"])
            total_haber += int(entry["haber"])
            saldo_acumulado += int(entry["debe"]) - int(entry["haber"])
            mayor_entries.append(
                {
                    "fecha": entry["fecha"],
                    "asiento": entry["asiento"],
                    "tipo": entry["tipo"],
                    "descripcion": entry["descripcion"],
                    "debe": entry["debe"],
                    "haber": entry["haber"],
                    "saldo": saldo_acumulado,
                }
            )

        return {
            "codCuenta": cod,
            "nombreCuenta": nombre,
            "saldoInicial": saldo_inicial,
            "entries": mayor_entries,
            "totalDebe": total_debe,
            "totalHaber": total_haber,
            "saldoFinal": saldo_acumulado,
        }

    def get_anomalies_data(self, ruc: str, periodos: list[str]) -> dict[str, Any] | None:
        if not periodos:
            return None
        sorted_periods = sorted(periodos)
        cache_key = self._period_key(sorted_periods)
        cached = self._get_analysis_cache(ruc, "anomalies", cache_key)
        if cached is not None:
            return cached
        entries = self._entries_for_periods(ruc, sorted_periods)
        result = analyze_anomalies(entries)
        self._set_analysis_cache(ruc, "anomalies", cache_key, result)
        return result

    def get_cash_flow_summary(self, ruc: str, periodos: list[str]) -> dict[str, Any]:
        entries = self._entries_for_periods(ruc, sorted(periodos))
        cash_in = 0
        cash_out = 0

        for entry in entries:
            code = str(entry["codCuenta"])
            name = str(entry["nombreCuenta"]).lower()
            is_cash_account = (
                code.startswith("1.1.1")
                or "banco" in name
                or "caja" in name
                or "efectivo" in name
            )
            if not is_cash_account:
                continue
            cash_in += int(entry["debe"])
            cash_out += int(entry["haber"])

        return {
            "cashIn": cash_in,
            "cashOut": cash_out,
            "netCashFlow": cash_in - cash_out,
            "periodos": sorted(periodos),
        }

    def get_comparativo_data(
        self,
        ruc: str,
        periodos_a: list[str],
        periodos_b: list[str],
    ) -> dict[str, Any] | None:
        if not periodos_a or not periodos_b:
            return None
        sorted_a = sorted(periodos_a)
        sorted_b = sorted(periodos_b)
        cache_key = f"A:{self._period_key(sorted_a)}|B:{self._period_key(sorted_b)}"
        cached = self._get_analysis_cache(ruc, "comparativo", cache_key)
        if cached is not None:
            return cached
        a = self.get_dashboard_data(ruc, sorted_a)
        b = self.get_dashboard_data(ruc, sorted_b)
        if not a or not b:
            return None
        result = {"a": a, "b": b}
        self._set_analysis_cache(ruc, "comparativo", cache_key, result)
        return result

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
        if not re.fullmatch(r"^(\d{6}|saldos_iniciales_\d{4})\.csv$", filename, re.IGNORECASE):
            return {"ok": False, "error": "Nombre invalido. Usa YYYYMM.csv o saldos_iniciales_YYYY.csv"}

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
                    proposal = ai_proposal
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
            importer = getattr(self.storage, "upsert_journal_import", None)
            if callable(importer):
                importer(
                    ruc,
                    filename,
                    content,
                    normalized["entries"],
                    {
                        "provider": normalized["provider"],
                        "mapping": normalized["mapping"],
                        "confidence": normalized["confidence"],
                        "warnings": normalized["warnings"],
                        "row_count": len(normalized["entries"]),
                        "error_count": len(normalized["errors"]),
                    },
                )
            else:
                self.storage.upsert(ruc, filename, self._entries_to_canonical_csv(normalized["entries"]))
            self._invalidate_analysis_cache(ruc)
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
            importer = getattr(self.storage, "upsert_opening_balance_import", None)
            if callable(importer):
                importer(
                    ruc,
                    filename,
                    content,
                    normalized["balances"],
                    {
                        "provider": normalized["provider"],
                        "mapping": normalized["mapping"],
                        "confidence": normalized["confidence"],
                        "warnings": normalized["warnings"],
                        "row_count": len(normalized["balances"]),
                        "error_count": len(normalized["errors"]),
                    },
                )
            else:
                self.storage.upsert(ruc, filename, self._opening_balances_to_canonical_csv(normalized["balances"]))
            self._invalidate_analysis_cache(ruc)
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

    def _mapping_required_response(self, filename: str, proposal: dict[str, Any]) -> dict[str, Any]:
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

    def save_company_config(self, config: dict[str, Any]) -> dict[str, Any]:
        ruc = str(config.get("ruc", "")).strip()
        if not VALID_RUC.fullmatch(ruc):
            return {"ok": False, "error": "RUC invalido (debe tener 13 digitos)"}
        try:
            self.storage.upsert(ruc, "config.json", json.dumps(config, indent=2, ensure_ascii=False))
            self._invalidate_analysis_cache(ruc)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True}

    def clone_company(
        self,
        source_ruc: str,
        dest_ruc: str,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        source_ruc = (source_ruc or "").strip()
        dest_ruc = (dest_ruc or "").strip()
        if not VALID_RUC.fullmatch(source_ruc):
            return {"ok": False, "error": "RUC origen invalido"}
        if not VALID_RUC.fullmatch(dest_ruc):
            return {"ok": False, "error": "RUC destino invalido (debe tener 13 digitos)"}
        if source_ruc == dest_ruc:
            return {"ok": False, "error": "El RUC destino debe ser distinto del origen"}

        source_files = [
            name for name in self.storage.list_files(source_ruc) if name.lower() != "config.json"
        ]
        if not source_files:
            return {"ok": False, "error": "La empresa origen no tiene datos para clonar"}
        if self.storage.list_files(dest_ruc):
            return {"ok": False, "error": f"La empresa {dest_ruc} ya existe"}

        try:
            for filename in source_files:
                content = self.storage.read(source_ruc, filename)
                if content is not None:
                    self.storage.upsert(dest_ruc, filename, content)

            merged: dict[str, Any] = dict(self.get_company_config(source_ruc) or {})
            if config:
                merged.update(config)
            merged["ruc"] = dest_ruc
            merged.setdefault("isDemo", True)
            merged.setdefault("createdAt", datetime.now(timezone.utc).isoformat())
            self.storage.upsert(
                dest_ruc, "config.json", json.dumps(merged, indent=2, ensure_ascii=False)
            )
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "ruc": dest_ruc}

    def get_company_config(self, ruc: str) -> dict[str, Any] | None:
        if not VALID_RUC.fullmatch(ruc):
            return None
        content = self.storage.read(ruc, "config.json")
        if content is None:
            return None
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def get_notas_data(self, ruc: str, periodos: list[str]) -> dict[str, Any] | None:
        if not periodos:
            return None
        dashboard = self.get_dashboard_data(ruc, periodos)
        if not dashboard:
            return None
        return {
            "esf": dashboard["esf"],
            "eri": dashboard["eri"],
            "config": self.get_company_config(ruc),
            "ruc": ruc,
            "periodos": periodos,
        }

    def _period_key(self, periodos: list[str]) -> str:
        return ",".join(sorted(periodos))

    def _get_analysis_cache(self, ruc: str, analysis_type: str, period_key: str) -> dict[str, Any] | None:
        getter = getattr(self.storage, "get_analysis_cache", None)
        if not callable(getter):
            return None
        cached = getter(ruc, analysis_type, period_key)
        return cached if isinstance(cached, dict) else None

    def _set_analysis_cache(self, ruc: str, analysis_type: str, period_key: str, payload: dict[str, Any]) -> None:
        setter = getattr(self.storage, "set_analysis_cache", None)
        if callable(setter):
            setter(ruc, analysis_type, period_key, payload)

    def _invalidate_analysis_cache(self, ruc: str) -> None:
        invalidator = getattr(self.storage, "invalidate_analysis_cache", None)
        if callable(invalidator):
            invalidator(ruc)

    def _entries_to_canonical_csv(self, entries: list[JournalEntry]) -> str:
        lines = ["fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto"]
        for entry in entries:
            lines.append(
                ",".join(
                    [
                        self._csv_cell(str(entry.get("fecha", ""))),
                        self._csv_cell(str(entry.get("asiento", ""))),
                        self._csv_cell(str(entry.get("tipo", ""))),
                        self._csv_cell(str(entry.get("codCuenta", ""))),
                        self._csv_cell(str(entry.get("nombreCuenta", ""))),
                        self._csv_cell(str(entry.get("descripcion", ""))),
                        f"{int(entry.get('debe', 0)) / 100:.2f}",
                        f"{int(entry.get('haber', 0)) / 100:.2f}",
                        self._csv_cell(str(entry.get("centroCosto", ""))),
                    ]
                )
            )
        return "\n".join(lines) + "\n"

    def _opening_balances_to_canonical_csv(self, balances: list[SaldoCuenta]) -> str:
        lines = ["Cod_Cuenta,Nombre_Cuenta,Saldo_Inicial,Tipo"]
        for balance in balances:
            saldo = int(balance.get("saldo", 0))
            lines.append(
                ",".join(
                    [
                        self._csv_cell(str(balance.get("codCuenta", ""))),
                        self._csv_cell(str(balance.get("nombreCuenta", ""))),
                        f"{abs(saldo) / 100:.2f}",
                        "A" if saldo < 0 else "D",
                    ]
                )
            )
        return "\n".join(lines) + "\n"

    def _csv_cell(self, value: str) -> str:
        if any(char in value for char in [",", '"', "\n"]):
            return '"' + value.replace('"', '""') + '"'
        return value
