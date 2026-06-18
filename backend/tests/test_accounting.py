from backend.app.domain.financial.accounting import (
    calcular_metricas,
    calcular_saldos_por_cuenta,
    generar_eri,
    generar_esf,
    parse_multiple_periods_content,
    parse_opening_balances_content,
)


def test_dashboard_accounting_shapes_match_frontend_contract():
    opening = parse_opening_balances_content(
        "\n".join(
            [
                "Cod_Cuenta,Nombre_Cuenta,Saldo_Inicial,Tipo",
                "1.1.1.01,Caja,1000.00,D",
                "2.1.1.01,Cuentas por pagar,200.00,A",
                "3.1.1.01,Capital,800.00,A",
            ]
        )
    )
    parsed = parse_multiple_periods_content(
        [
            {
                "periodo": "202501",
                "content": "\n".join(
                    [
                        "fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto",
                        "2025-01-01,A1,VT,1.1.3.01,Cuentas por cobrar,Factura 1,150.00,0.00,VENTAS",
                        "2025-01-01,A1,VT,4.1.1.01,Ventas,Factura 1,0.00,150.00,VENTAS",
                        "2025-01-02,A2,CV,5.1.1.01,Costo ventas,Costo 1,50.00,0.00,VENTAS",
                        "2025-01-02,A2,CV,1.1.5.01,Inventario,Costo 1,0.00,50.00,VENTAS",
                    ]
                ),
            }
        ]
    )

    saldos_esf = calcular_saldos_por_cuenta(parsed["entries"], opening)
    saldos_eri = calcular_saldos_por_cuenta(parsed["entries"])
    esf = generar_esf(saldos_esf)
    eri = generar_eri(saldos_eri)
    metricas = calcular_metricas(esf, eri, "comercial", 30)

    assert parsed["errors"] == []
    assert esf["totalActivos"] == 110000
    assert eri["ingresos"]["total"] == 15000
    assert eri["costoVentas"]["total"] == 5000
    assert eri["utilidadNeta"] == 6375
    assert "rentabilidad" in metricas
