from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

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
from .cache import AnalysisCache
from .imports import CsvImporter, MappingProvider
from .ledger import build_mayor, build_mayor_response, cuenta_map
from backend.app.storage import CsvStorage, VALID_RUC


MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]


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
    """Public domain API consumed by the API routes. Reads data through the
    storage backend and delegates specialized work to focused modules:
    ledger (libro mayor), imports (CSV upload), and cache (analysis memoization).
    """

    def __init__(self, storage: CsvStorage) -> None:
        self.storage = storage
        self.cache = AnalysisCache(storage)

    def for_workspace(self, workspace_id: str) -> "FinancialService":
        return FinancialService(self.storage.for_workspace(workspace_id))

    def get_available_rucs(self) -> list[str]:
        return self.storage.list_rucs()

    def get_all_periods(self, rucs: list[str]) -> dict[str, list[str]]:
        return {ruc: self.storage.list_periods(ruc) for ruc in rucs}

    # -- data fetch helpers ------------------------------------------------

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

    # -- analyses ----------------------------------------------------------

    def get_dashboard_data(self, ruc: str, periodos: list[str]) -> dict[str, Any] | None:
        if not periodos:
            return None

        sorted_periods = sorted(periodos)
        cache_key = self.cache.period_key(sorted_periods)
        cached = self.cache.get(ruc, "dashboard", cache_key)
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
        self.cache.set(ruc, "dashboard", cache_key, result)
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
        return build_mayor_response(entries, opening, cod_cuenta)

    def get_mayor_completo_data(self, ruc: str, periodos: list[str]) -> list[dict[str, Any]]:
        if not periodos:
            return []

        sorted_periods = sorted(periodos)
        year = year_from_period(sorted_periods[0])
        entries = self._entries_for_periods(ruc, sorted_periods)
        opening = self._opening_balances(ruc, year)
        accounts = cuenta_map(entries, opening)
        return [build_mayor(entries, opening, cod, accounts[cod]) for cod in sorted(accounts)]

    def get_anomalies_data(self, ruc: str, periodos: list[str]) -> dict[str, Any] | None:
        if not periodos:
            return None
        sorted_periods = sorted(periodos)
        cache_key = self.cache.period_key(sorted_periods)
        cached = self.cache.get(ruc, "anomalies", cache_key)
        if cached is not None:
            return cached
        entries = self._entries_for_periods(ruc, sorted_periods)
        result = analyze_anomalies(entries)
        self.cache.set(ruc, "anomalies", cache_key, result)
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
        cache_key = f"A:{self.cache.period_key(sorted_a)}|B:{self.cache.period_key(sorted_b)}"
        cached = self.cache.get(ruc, "comparativo", cache_key)
        if cached is not None:
            return cached
        a = self.get_dashboard_data(ruc, sorted_a)
        b = self.get_dashboard_data(ruc, sorted_b)
        if not a or not b:
            return None
        result = {"a": a, "b": b}
        self.cache.set(ruc, "comparativo", cache_key, result)
        return result

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

    # -- mutations ---------------------------------------------------------

    def upload_csv(
        self,
        ruc: str,
        filename: str,
        content: str,
        mapping: dict[str, Any] | None = None,
        mapping_provider: MappingProvider | None = None,
    ) -> dict[str, Any]:
        return CsvImporter(self.storage, self.cache).upload_csv(
            ruc, filename, content, mapping, mapping_provider
        )

    def save_company_config(self, config: dict[str, Any]) -> dict[str, Any]:
        ruc = str(config.get("ruc", "")).strip()
        if not VALID_RUC.fullmatch(ruc):
            return {"ok": False, "error": "RUC invalido (debe tener 13 digitos)"}
        try:
            self.storage.upsert(ruc, "config.json", json.dumps(config, indent=2, ensure_ascii=False))
            self.cache.invalidate(ruc)
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
