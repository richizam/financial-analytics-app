from __future__ import annotations

import csv
import io
import math
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


JournalEntry = dict[str, Any]
SaldoCuenta = dict[str, Any]

BENFORD_EXPECTED: dict[int, float] = {
    1: 0.301,
    2: 0.176,
    3: 0.125,
    4: 0.097,
    5: 0.079,
    6: 0.067,
    7: 0.058,
    8: 0.051,
    9: 0.046,
}

UMBRALES: dict[str, dict[str, dict[str, float]]] = {
    "comercial": {
        "margenBruto": {"alerta": 0.10, "normal": 0.20, "bueno": 0.35},
        "margenNeto": {"alerta": 0.02, "normal": 0.05, "bueno": 0.10},
        "margenEbitda": {"alerta": 0.05, "normal": 0.12, "bueno": 0.20},
        "razonCorriente": {"alerta": 1.0, "normal": 1.3, "bueno": 1.8},
        "pruebaAcida": {"alerta": 0.6, "normal": 0.9, "bueno": 1.2},
        "razonEndeudamiento": {"alerta": 0.70, "normal": 0.55, "bueno": 0.40},
        "coberturaIntereses": {"alerta": 1.5, "normal": 2.5, "bueno": 4.0},
        "rotacionCartera": {"alerta": 90, "normal": 60, "bueno": 30},
        "rotacionInventario": {"alerta": 90, "normal": 45, "bueno": 30},
    },
    "servicios": {
        "margenBruto": {"alerta": 0.30, "normal": 0.45, "bueno": 0.60},
        "margenNeto": {"alerta": 0.05, "normal": 0.12, "bueno": 0.20},
        "margenEbitda": {"alerta": 0.10, "normal": 0.18, "bueno": 0.28},
        "razonCorriente": {"alerta": 1.0, "normal": 1.5, "bueno": 2.0},
        "pruebaAcida": {"alerta": 0.8, "normal": 1.2, "bueno": 1.6},
        "razonEndeudamiento": {"alerta": 0.65, "normal": 0.50, "bueno": 0.35},
        "coberturaIntereses": {"alerta": 2.0, "normal": 3.0, "bueno": 5.0},
        "rotacionCartera": {"alerta": 60, "normal": 40, "bueno": 25},
        "rotacionInventario": {"alerta": 0, "normal": 0, "bueno": 0},
    },
    "industrial": {
        "margenBruto": {"alerta": 0.15, "normal": 0.28, "bueno": 0.40},
        "margenNeto": {"alerta": 0.03, "normal": 0.07, "bueno": 0.15},
        "margenEbitda": {"alerta": 0.08, "normal": 0.15, "bueno": 0.25},
        "razonCorriente": {"alerta": 1.1, "normal": 1.5, "bueno": 2.0},
        "pruebaAcida": {"alerta": 0.7, "normal": 1.0, "bueno": 1.4},
        "razonEndeudamiento": {"alerta": 0.70, "normal": 0.55, "bueno": 0.40},
        "coberturaIntereses": {"alerta": 2.0, "normal": 3.5, "bueno": 5.0},
        "rotacionCartera": {"alerta": 75, "normal": 50, "bueno": 30},
        "rotacionInventario": {"alerta": 120, "normal": 60, "bueno": 30},
    },
    "construccion": {
        "margenBruto": {"alerta": 0.12, "normal": 0.22, "bueno": 0.35},
        "margenNeto": {"alerta": 0.04, "normal": 0.08, "bueno": 0.15},
        "margenEbitda": {"alerta": 0.08, "normal": 0.14, "bueno": 0.22},
        "razonCorriente": {"alerta": 1.2, "normal": 1.6, "bueno": 2.2},
        "pruebaAcida": {"alerta": 0.8, "normal": 1.1, "bueno": 1.5},
        "razonEndeudamiento": {"alerta": 0.75, "normal": 0.60, "bueno": 0.45},
        "coberturaIntereses": {"alerta": 1.5, "normal": 2.5, "bueno": 4.0},
        "rotacionCartera": {"alerta": 90, "normal": 60, "bueno": 40},
        "rotacionInventario": {"alerta": 0, "normal": 0, "bueno": 0},
    },
    "otro": {
        "margenBruto": {"alerta": 0.15, "normal": 0.25, "bueno": 0.40},
        "margenNeto": {"alerta": 0.03, "normal": 0.08, "bueno": 0.15},
        "margenEbitda": {"alerta": 0.07, "normal": 0.14, "bueno": 0.22},
        "razonCorriente": {"alerta": 1.0, "normal": 1.4, "bueno": 1.8},
        "pruebaAcida": {"alerta": 0.7, "normal": 1.0, "bueno": 1.4},
        "razonEndeudamiento": {"alerta": 0.70, "normal": 0.55, "bueno": 0.40},
        "coberturaIntereses": {"alerta": 1.5, "normal": 2.5, "bueno": 4.0},
        "rotacionCartera": {"alerta": 75, "normal": 50, "bueno": 30},
        "rotacionInventario": {"alerta": 90, "normal": 45, "bueno": 30},
    },
}


def to_cents(value: str) -> int:
    try:
        amount = Decimal((value or "").strip())
    except InvalidOperation:
        return 0
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def year_from_period(periodo: str) -> int:
    return int(periodo[:4])


def _rows(content: str) -> list[list[str]]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    return [[field.strip() for field in row] for row in csv.reader(io.StringIO(normalized))]


def _parse_csv_content(content: str, periodo: str) -> dict[str, Any]:
    entries: list[JournalEntry] = []
    errors: list[dict[str, Any]] = []

    for index, fields in enumerate(_rows(content)[1:], start=2):
        if not fields or all(not field for field in fields):
            continue
        if len(fields) < 9:
            errors.append(
                {
                    "asiento": f"fila {index}",
                    "tipo": "formato_invalido",
                    "detalle": f"Se esperaban 9 columnas, se encontraron {len(fields)}",
                }
            )
            continue

        fecha, asiento, tipo, cod_cuenta, nombre_cuenta, descripcion, debe, haber, centro_costo = fields[:9]
        entries.append(
            {
                "fecha": fecha,
                "asiento": asiento,
                "tipo": tipo,
                "codCuenta": cod_cuenta,
                "nombreCuenta": nombre_cuenta,
                "descripcion": descripcion,
                "debe": to_cents(debe),
                "haber": to_cents(haber),
                "centroCosto": centro_costo,
                "periodo": periodo,
            }
        )

    return {"entries": entries, "errors": errors}


def _validate_double_entry(entries: list[JournalEntry]) -> list[dict[str, Any]]:
    by_asiento: dict[str, list[JournalEntry]] = {}
    for entry in entries:
        by_asiento.setdefault(entry["asiento"], []).append(entry)

    errors: list[dict[str, Any]] = []
    for asiento, lines in by_asiento.items():
        total_debe = sum(int(line["debe"]) for line in lines)
        total_haber = sum(int(line["haber"]) for line in lines)
        diferencia = total_debe - total_haber
        if diferencia != 0:
            errors.append(
                {
                    "asiento": asiento,
                    "tipo": "desequilibrio",
                    "detalle": f"Debe {total_debe / 100:.2f} != Haber {total_haber / 100:.2f}",
                    "diferencia": diferencia,
                }
            )
    return errors


def parse_period_content(content: str, periodo: str) -> dict[str, Any]:
    parsed = _parse_csv_content(content, periodo)
    validation_errors = _validate_double_entry(parsed["entries"])
    return {
        "entries": parsed["entries"],
        "periodosLeidos": [periodo] if parsed["entries"] else [],
        "errors": [*parsed["errors"], *validation_errors],
    }


def parse_multiple_periods_content(contents: list[dict[str, str]]) -> dict[str, Any]:
    all_entries: list[JournalEntry] = []
    all_errors: list[dict[str, Any]] = []
    periodos_leidos: list[str] = []

    for item in contents:
        parsed = _parse_csv_content(item["content"], item["periodo"])
        all_entries.extend(parsed["entries"])
        all_errors.extend(parsed["errors"])
        if parsed["entries"]:
            periodos_leidos.append(item["periodo"])

    return {
        "entries": all_entries,
        "periodosLeidos": periodos_leidos,
        "errors": [*all_errors, *_validate_double_entry(all_entries)],
    }


def parse_opening_balances_content(content: str) -> dict[str, SaldoCuenta]:
    saldos: dict[str, SaldoCuenta] = {}
    for fields in _rows(content)[1:]:
        if not fields or all(not field for field in fields):
            continue
        if len(fields) < 4:
            continue

        cod_cuenta, nombre_cuenta, saldo_str, tipo_str = fields[:4]
        raw_abs = abs(to_cents(saldo_str))
        saldo = -raw_abs if tipo_str.strip().upper() == "A" else raw_abs
        saldos[cod_cuenta] = {
            "codCuenta": cod_cuenta,
            "nombreCuenta": nombre_cuenta,
            "totalDebe": saldo if saldo > 0 else 0,
            "totalHaber": -saldo if saldo < 0 else 0,
            "saldo": saldo,
        }
    return saldos


def calcular_saldos_por_cuenta(
    entries: list[JournalEntry],
    opening_balances: dict[str, SaldoCuenta] | None = None,
) -> dict[str, SaldoCuenta]:
    saldos: dict[str, SaldoCuenta] = {
        key: dict(value) for key, value in (opening_balances or {}).items()
    }

    for entry in entries:
        cod = entry["codCuenta"]
        current = saldos.get(cod)
        if current is None:
            current = {
                "codCuenta": cod,
                "nombreCuenta": entry["nombreCuenta"],
                "totalDebe": 0,
                "totalHaber": 0,
                "saldo": 0,
            }
            saldos[cod] = current
        current["totalDebe"] += int(entry["debe"])
        current["totalHaber"] += int(entry["haber"])
        current["saldo"] = current["totalDebe"] - current["totalHaber"]

    return saldos


def clasificar_cuenta(cod_cuenta: str) -> str:
    parts = cod_cuenta.split(".")
    n1 = parts[0] if parts else ""
    n2 = parts[1] if len(parts) > 1 else "1"

    if n1 == "1":
        return "activo_corriente" if n2 == "1" else "activo_no_corriente"
    if n1 == "2":
        return "pasivo_corriente" if n2 == "1" else "pasivo_no_corriente"
    if n1 == "3":
        return "patrimonio"
    if n1 == "4":
        return "ingreso"
    if n1 == "5":
        if n2 == "1":
            return "costo_ventas"
        if n2 == "2":
            return "gasto_operacion"
        return "gasto_otro"
    return "desconocido"


def _build_section(
    saldos: dict[str, SaldoCuenta],
    grupo: str,
    titulo: str,
    monto_fn,
) -> dict[str, Any]:
    items = [
        {
            "codCuenta": saldo["codCuenta"],
            "nombreCuenta": saldo["nombreCuenta"],
            "monto": monto_fn(int(saldo["saldo"])),
            "saldo": int(saldo["saldo"]),
        }
        for saldo in saldos.values()
        if clasificar_cuenta(str(saldo["codCuenta"])) == grupo
    ]
    items.sort(key=lambda item: item["codCuenta"])
    raw_total = sum(int(item["saldo"]) for item in items)
    return {"titulo": titulo, "items": items, "total": abs(monto_fn(raw_total))}


def generar_esf(saldos: dict[str, SaldoCuenta]) -> dict[str, Any]:
    activos_corrientes = _build_section(saldos, "activo_corriente", "Activos Corrientes", lambda s: s)
    activos_no_corrientes = _build_section(saldos, "activo_no_corriente", "Activos No Corrientes", lambda s: s)
    total_activos_raw = sum(item["saldo"] for item in activos_corrientes["items"]) + sum(
        item["saldo"] for item in activos_no_corrientes["items"]
    )

    pasivos_corrientes = _build_section(saldos, "pasivo_corriente", "Pasivos Corrientes", lambda s: -s)
    pasivos_no_corrientes = _build_section(
        saldos, "pasivo_no_corriente", "Pasivos No Corrientes", lambda s: -s
    )
    patrimonio = _build_section(saldos, "patrimonio", "Patrimonio", lambda s: -s)

    total_pasivos = pasivos_corrientes["total"] + pasivos_no_corrientes["total"]
    total_patrimonio = patrimonio["total"]
    total_pasivos_mas_patrimonio = total_pasivos + total_patrimonio
    total_activos = abs(total_activos_raw)

    return {
        "activosCorrientes": activos_corrientes,
        "activosNoCorrientes": activos_no_corrientes,
        "totalActivos": total_activos,
        "pasivosCorrientes": pasivos_corrientes,
        "pasivosNoCorrientes": pasivos_no_corrientes,
        "totalPasivos": total_pasivos,
        "patrimonio": patrimonio,
        "totalPatrimonio": total_patrimonio,
        "totalPasivosMasPatrimonio": total_pasivos_mas_patrimonio,
        "diferencia": total_activos - total_pasivos_mas_patrimonio,
    }


def _is_depreciacion_o_amortizacion(saldo: SaldoCuenta) -> bool:
    nombre = str(saldo["nombreCuenta"]).lower()
    cod = str(saldo["codCuenta"])
    return "depreci" in nombre or "amortiz" in nombre or cod.startswith("5.2.3") or cod.startswith("5.2.4")


def generar_eri(saldos: dict[str, SaldoCuenta]) -> dict[str, Any]:
    ingresos = _build_section(saldos, "ingreso", "Ingresos de actividades ordinarias", lambda s: -s)
    costo_ventas = _build_section(saldos, "costo_ventas", "Costo de ventas", lambda s: s)
    gastos_operacion = _build_section(saldos, "gasto_operacion", "Gastos de operacion", lambda s: s)
    otros_gastos = _build_section(saldos, "gasto_otro", "Otros gastos", lambda s: s)

    total_ingresos = ingresos["total"]
    utilidad_bruta = total_ingresos - costo_ventas["total"]
    utilidad_operacional = utilidad_bruta - gastos_operacion["total"]
    depreciacion = sum(
        int(saldo["saldo"])
        for saldo in saldos.values()
        if clasificar_cuenta(str(saldo["codCuenta"])) == "gasto_operacion"
        and _is_depreciacion_o_amortizacion(saldo)
    )
    ebitda = utilidad_operacional + depreciacion

    pt_en_asientos = any(str(key).startswith("2.1.4.03") for key in saldos)
    ir_en_asientos = any(str(key).startswith("2.1.5") for key in saldos)
    utilidad_antes_participacion = utilidad_operacional - otros_gastos["total"]
    participacion_trabajadores = (
        0 if pt_en_asientos else round(max(0, utilidad_antes_participacion) * 0.15)
    )
    utilidad_antes_ir = utilidad_antes_participacion - participacion_trabajadores
    impuesto_renta = 0 if ir_en_asientos else round(max(0, utilidad_antes_ir) * 0.25)
    utilidad_neta = utilidad_antes_ir - impuesto_renta

    def safe_margen(value: int) -> float:
        return value / total_ingresos if total_ingresos else 0

    return {
        "ingresos": ingresos,
        "costoVentas": costo_ventas,
        "utilidadBruta": utilidad_bruta,
        "margenBruto": safe_margen(utilidad_bruta),
        "gastosOperacion": gastos_operacion,
        "utilidadOperacional": utilidad_operacional,
        "ebitda": ebitda,
        "margenEbitda": safe_margen(ebitda),
        "otrosGastos": otros_gastos,
        "utilidadAntesParticipacion": utilidad_antes_participacion,
        "participacionTrabajadores": participacion_trabajadores,
        "utilidadAntesIR": utilidad_antes_ir,
        "impuestoRenta": impuesto_renta,
        "utilidadNeta": utilidad_neta,
        "margenNeto": safe_margen(utilidad_neta),
        "ptEnAsientos": pt_en_asientos,
        "irEnAsientos": ir_en_asientos,
    }


def _sum_by_prefix(section: dict[str, Any], prefix: str) -> int:
    return sum(abs(int(item["monto"])) for item in section["items"] if item["codCuenta"].startswith(prefix))


def _safe_div(num: int | float, den: int | float) -> float | None:
    return None if den == 0 else num / den


def _semaforo(valor: float | None, umbral: dict[str, float], invertido: bool = False) -> str:
    if valor is None:
        return "gray"
    if not invertido:
        if valor >= umbral["bueno"]:
            return "green"
        if valor >= umbral["normal"]:
            return "yellow"
        return "red"
    if valor <= umbral["bueno"]:
        return "green"
    if valor <= umbral["normal"]:
        return "yellow"
    return "red"


def _ratio(
    clave: str,
    etiqueta: str,
    valor: float | int | None,
    unidad: str,
    umbral: dict[str, float] | None,
    invertido: bool = False,
) -> dict[str, Any]:
    estado = _semaforo(valor, umbral, invertido) if umbral else ("gray" if valor is None else "green")
    ratio = {"clave": clave, "etiqueta": etiqueta, "valor": valor, "unidad": unidad, "estado": estado}
    if umbral:
        ratio["umbral"] = umbral
    return ratio


def calcular_metricas(
    esf: dict[str, Any],
    eri: dict[str, Any],
    sector: str = "comercial",
    dias_periodo: int = 365,
) -> dict[str, Any]:
    sector_key = sector if sector in UMBRALES else "otro"
    u = UMBRALES[sector_key]

    activos_corrientes = esf["activosCorrientes"]["total"]
    pasivos_corrientes = esf["pasivosCorrientes"]["total"]
    total_activos = esf["totalActivos"]
    total_pasivos = esf["totalPasivos"]
    total_patrimonio = esf["totalPatrimonio"]

    cuentas_cobrar = _sum_by_prefix(esf["activosCorrientes"], "1.1.3")
    inventarios = _sum_by_prefix(esf["activosCorrientes"], "1.1.5")
    cuentas_pagar = _sum_by_prefix(esf["pasivosCorrientes"], "2.1.1")

    ingresos = eri["ingresos"]["total"]
    costo_ventas = eri["costoVentas"]["total"]
    utilidad_neta = eri["utilidadNeta"]
    utilidad_operacional = eri["utilidadOperacional"]
    ebitda = eri["ebitda"]
    patrimonio_efectivo = total_patrimonio + utilidad_neta

    rentabilidad = [
        _ratio("margenBruto", "Margen bruto", eri["margenBruto"] if ingresos else None, "porcentaje", u["margenBruto"]),
        _ratio("margenNeto", "Margen neto", eri["margenNeto"] if ingresos else None, "porcentaje", u["margenNeto"]),
        _ratio(
            "margenEbitda",
            "Margen EBITDA",
            eri["margenEbitda"] if ingresos else None,
            "porcentaje",
            u["margenEbitda"],
        ),
        _ratio("roe", "ROE (Retorno sobre patrimonio)", _safe_div(utilidad_neta, patrimonio_efectivo), "porcentaje", None),
        _ratio("roa", "ROA (Retorno sobre activos)", _safe_div(utilidad_neta, total_activos), "porcentaje", None),
    ]

    activos_corr_sin_inventario = activos_corrientes - inventarios
    capital_trabajo = activos_corrientes - pasivos_corrientes
    liquidez = [
        _ratio("razonCorriente", "Razon corriente", _safe_div(activos_corrientes, pasivos_corrientes), "veces", u["razonCorriente"]),
        _ratio("pruebaAcida", "Prueba acida", _safe_div(activos_corr_sin_inventario, pasivos_corrientes), "veces", u["pruebaAcida"]),
        _ratio("capitalTrabajo", "Capital de trabajo (neto)", capital_trabajo, "moneda", None),
    ]

    endeudamiento = [
        _ratio(
            "razonEndeudamiento",
            "Razon de endeudamiento",
            _safe_div(total_pasivos, total_activos),
            "porcentaje",
            u["razonEndeudamiento"],
            True,
        ),
        _ratio("apalancamiento", "Apalancamiento financiero", _safe_div(total_activos, patrimonio_efectivo), "veces", None),
        _ratio("coberturaIntereses", "Cobertura de intereses", None, "veces", u["coberturaIntereses"]),
    ]

    rotacion_cartera = _safe_div(cuentas_cobrar, ingresos) if cuentas_cobrar and ingresos else None
    rotacion_inventario = _safe_div(inventarios, costo_ventas) if inventarios and costo_ventas else None
    rotacion_proveedor = _safe_div(cuentas_pagar, costo_ventas) if cuentas_pagar and costo_ventas else None
    dias_cobro = rotacion_cartera * dias_periodo if rotacion_cartera is not None else None
    dias_inventario = rotacion_inventario * dias_periodo if rotacion_inventario is not None else None
    dias_pago = rotacion_proveedor * dias_periodo if rotacion_proveedor is not None else None
    cce = (
        dias_cobro + dias_inventario - dias_pago
        if dias_cobro is not None and dias_inventario is not None and dias_pago is not None
        else None
    )
    incluye_inventario = sector_key not in {"servicios", "construccion"} and inventarios > 0

    eficiencia = [
        _ratio("diasCobro", "Dias de cobro (DSO)", dias_cobro, "dias", u["rotacionCartera"], True),
    ]
    if incluye_inventario:
        eficiencia.append(
            _ratio("diasInventario", "Dias de inventario (DIO)", dias_inventario, "dias", u["rotacionInventario"], True)
        )
    eficiencia.append(_ratio("diasPago", "Dias de pago a proveedores", dias_pago, "dias", None))
    if incluye_inventario:
        eficiencia.append(_ratio("cce", "Ciclo de conversion de efectivo", cce, "dias", None, True))

    return {
        "rentabilidad": rentabilidad,
        "liquidez": liquidez,
        "endeudamiento": endeudamiento,
        "eficiencia": eficiencia,
    }


def analyze_benford(entries: list[JournalEntry]) -> dict[str, Any]:
    amounts: list[int] = []
    for entry in entries:
        if entry["debe"] > 0:
            amounts.append(entry["debe"])
        if entry["haber"] > 0:
            amounts.append(entry["haber"])

    counts: dict[int, int] = {}
    sample_size = 0
    for amount in amounts:
        dollars = abs(amount / 100)
        if dollars < 1:
            continue
        digit = int(str(math.floor(dollars))[0])
        if 1 <= digit <= 9:
            counts[digit] = counts.get(digit, 0) + 1
            sample_size += 1

    chi_square = 0.0
    digits: list[dict[str, Any]] = []
    for digit in range(1, 10):
        expected = BENFORD_EXPECTED[digit]
        observed_count = counts.get(digit, 0)
        expected_count = sample_size * expected
        if expected_count > 0:
            chi_square += (observed_count - expected_count) ** 2 / expected_count
        digits.append(
            {
                "digit": digit,
                "expected": expected,
                "observed": observed_count / sample_size if sample_size else 0,
                "expectedCount": round(expected_count),
                "observedCount": observed_count,
            }
        )

    return {
        "chiSquare": chi_square,
        "suspicious": chi_square > 15.507,
        "riskLevel": "high" if chi_square > 20 else "medium" if chi_square > 15.507 else "low",
        "sampleSize": sample_size,
        "digits": digits,
    }


def find_duplicates(entries: list[JournalEntry]) -> list[dict[str, Any]]:
    by_signature: dict[str, list[JournalEntry]] = {}
    for entry in entries:
        monto = entry["debe"] if entry["debe"] > 0 else entry["haber"]
        key = f'{entry["fecha"]}|{entry["codCuenta"]}|{monto}|{entry["descripcion"]}'
        by_signature.setdefault(key, []).append(entry)

    groups: list[dict[str, Any]] = []
    for key, group in by_signature.items():
        if len(group) < 2:
            continue
        if len({entry["asiento"] for entry in group}) < 2:
            continue
        _, cod_cuenta, monto_text, _ = key.split("|", 3)
        groups.append(
            {
                "monto": int(monto_text),
                "codCuenta": cod_cuenta,
                "nombreCuenta": group[0]["nombreCuenta"],
                "entries": [
                    {
                        "fecha": entry["fecha"],
                        "asiento": entry["asiento"],
                        "codCuenta": entry["codCuenta"],
                        "nombreCuenta": entry["nombreCuenta"],
                        "descripcion": entry["descripcion"],
                        "debe": entry["debe"],
                        "haber": entry["haber"],
                    }
                    for entry in sorted(group, key=lambda item: item["asiento"])
                ],
            }
        )
    return sorted(groups, key=lambda item: item["monto"], reverse=True)


def find_outliers(entries: list[JournalEntry]) -> list[dict[str, Any]]:
    by_account: dict[str, list[JournalEntry]] = {}
    for entry in entries:
        by_account.setdefault(entry["codCuenta"], []).append(entry)

    outliers: list[dict[str, Any]] = []
    for account_entries in by_account.values():
        amounts = sorted(max(entry["debe"], entry["haber"]) for entry in account_entries if max(entry["debe"], entry["haber"]) > 0)
        if len(amounts) < 4:
            continue
        q1 = amounts[math.floor(len(amounts) * 0.25)]
        q3 = amounts[math.floor(len(amounts) * 0.75)]
        iqr = q3 - q1
        if iqr == 0:
            continue
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr

        for entry in account_entries:
            monto = max(entry["debe"], entry["haber"])
            if monto <= 0:
                continue
            if monto > upper:
                outliers.append(
                    {
                        "fecha": entry["fecha"],
                        "asiento": entry["asiento"],
                        "codCuenta": entry["codCuenta"],
                        "nombreCuenta": entry["nombreCuenta"],
                        "descripcion": entry["descripcion"],
                        "monto": monto,
                        "deviationFactor": round((monto - upper) / iqr, 1),
                        "direction": "high",
                    }
                )
            elif lower > 0 and monto < lower:
                outliers.append(
                    {
                        "fecha": entry["fecha"],
                        "asiento": entry["asiento"],
                        "codCuenta": entry["codCuenta"],
                        "nombreCuenta": entry["nombreCuenta"],
                        "descripcion": entry["descripcion"],
                        "monto": monto,
                        "deviationFactor": round((lower - monto) / iqr, 1),
                        "direction": "low",
                    }
                )

    return sorted(outliers, key=lambda item: item["deviationFactor"], reverse=True)


def analyze_anomalies(entries: list[JournalEntry]) -> dict[str, Any]:
    benford = analyze_benford(entries)
    duplicates = find_duplicates(entries)
    outliers = find_outliers(entries)
    benford_pts = 40 if benford["chiSquare"] > 20 else 25 if benford["chiSquare"] > 15.507 else 0
    duplicate_pts = min(30, len(duplicates) * 8)
    severe_outliers = len([item for item in outliers if item["deviationFactor"] > 3])
    outlier_pts = min(30, severe_outliers * 6)
    score = min(100, benford_pts + duplicate_pts + outlier_pts)
    risk_score = {
        "score": score,
        "nivel": "green" if score < 30 else "yellow" if score < 60 else "red",
        "components": {"benford": benford_pts, "duplicates": duplicate_pts, "outliers": outlier_pts},
    }
    return {
        "riskScore": risk_score,
        "benford": benford,
        "duplicates": duplicates,
        "outliers": outliers,
        "totalEntries": len(entries),
    }
