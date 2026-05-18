---
name: financial-reports
description: Generar los 5 estados financieros bajo NIIF en el formato que usa un contador o auditor en Ecuador. Activar cuando se construyan el ESF, ERI, ECP, EFE, notas a los EEFF, o informes de auditoría bajo estándares NIIF.
---

# Financial Reports Skill — NIIF (Ecuador)

## Cuándo se activa
- Construir vistas de los 5 estados financieros NIIF
- Generar PDFs o exportaciones de informes
- Implementar notas a los EEFF
- Crear secciones de dictamen o informe del auditor

## Estados financieros según marco NIIF

> Leer la configuración `company.niifFramework` antes de renderizar cualquier estado.

| Estado | NIIF Completas | NIIF para PYMES | RIMPE |
|--------|:---:|:---:|:---:|
| Estado de Situación Financiera (ESF) | ✓ | ✓ | Simplificado |
| Estado de Resultado Integral (ERI) con ORI | ✓ | Opcional* | ✗ |
| Estado de Resultados simple | — | ✓ | ✓ |
| Estado de Cambios en el Patrimonio (ECP) | ✓ | ✓ | ✗ |
| Estado de Flujos de Efectivo (EFE) | ✓ | ✓ | ✗ |
| Notas a los EEFF (completas) | ✓ | Reducidas | ✗ |

*NIIF para PYMES sección 5.4: puede presentar solo el Estado de Resultados sin ORI
si no tiene partidas de ORI.

### Diferencias clave entre marcos

**NIIF Completas vs NIIF para PYMES:**
- NIIF Completas requiere ORI completo (NIC 1) · PYMES puede omitirlo (Sección 5)
- NIIF Completas usa valor razonable amplio (NIIF 9/13) · PYMES usa costo amortizado
- NIIF Completas requiere NIIF 16 completo · PYMES tiene exención para arrendamientos menores
- NIIF Completas: notas muy extensas · PYMES: notas reducidas (35 secciones vs 41 NIIFs)

**RIMPE (microempresas):**
- Solo ESF simplificado y Estado de Resultados básico
- Sin ECP ni EFE obligatorios
- Sin ORI
- Plan de cuentas simplificado de 3 niveles
- Declaración anual en formulario 102A del SRI


## Los 5 estados financieros obligatorios bajo NIIF

> NIC 1 exige presentar los 5 estados. "Balance General" ya no es el término correcto.

| # | Nombre NIIF | Antes (NEC) |
|---|---|---|
| 1 | Estado de Situación Financiera (ESF) | Balance General |
| 2 | Estado de Resultado Integral (ERI) | Estado de Pérdidas y Ganancias |
| 3 | Estado de Cambios en el Patrimonio (ECP) | Estado de Evolución del Patrimonio |
| 4 | Estado de Flujos de Efectivo (EFE) | Flujo de Caja |
| 5 | Notas a los Estados Financieros | Notas |

---

### 1. Estado de Situación Financiera (ESF)

```
ACTIVOS
  Activos Corrientes
    Efectivo y equivalentes al efectivo                  1.1.1
    Activos financieros a valor razonable (NIIF 9)       1.1.2
    Cuentas y documentos por cobrar comerciales          1.1.3
    (-) Deterioro de cuentas por cobrar (NIIF 9)        1.1.3.1
    Otras cuentas por cobrar                             1.1.4
    Inventarios (NIC 2)                                  1.1.5
    Activos por impuestos corrientes                     1.1.6
    Otros activos corrientes                             1.1.7
  TOTAL ACTIVOS CORRIENTES

  Activos No Corrientes
    Propiedades, planta y equipo — neto (NIC 16)         1.2.1
    Activos por derecho de uso — neto (NIIF 16)          1.2.2   ← NUEVO bajo NIIF 16
    Propiedades de inversión (NIC 40)                    1.2.3
    Activos intangibles — neto (NIC 38)                  1.2.4
    Plusvalía (NIIF 3)                                   1.2.5
    Activos por impuestos diferidos (NIC 12)             1.2.6
    Otros activos no corrientes                          1.2.7
  TOTAL ACTIVOS NO CORRIENTES

TOTAL ACTIVOS

PASIVOS Y PATRIMONIO
  Pasivos Corrientes
    Cuentas y documentos por pagar comerciales           2.1.1
    Obligaciones financieras corrientes                  2.1.2
    Pasivos por arrendamiento corrientes (NIIF 16)       2.1.3   ← NUEVO bajo NIIF 16
    Pasivos por impuestos corrientes                     2.1.4
    Provisiones corrientes (NIC 37)                      2.1.5
    Otras cuentas por pagar corrientes                   2.1.6
  TOTAL PASIVOS CORRIENTES

  Pasivos No Corrientes
    Obligaciones financieras no corrientes               2.2.1
    Pasivos por arrendamiento no corrientes (NIIF 16)    2.2.2   ← NUEVO bajo NIIF 16
    Beneficios a empleados largo plazo (NIC 19)          2.2.3
    Pasivos por impuestos diferidos (NIC 12)             2.2.4
    Provisiones no corrientes (NIC 37)                   2.2.5
  TOTAL PASIVOS NO CORRIENTES

TOTAL PASIVOS

PATRIMONIO (NIC 1 / NIC 32)
  Capital suscrito y pagado                              3.1
  Prima de emisión                                       3.2
  Reserva legal                                          3.3
  Otras reservas                                         3.4
  Resultados acumulados                                  3.5
  Otro resultado integral acumulado (ORI)                3.6   ← EXCLUSIVO NIIF
  Resultado del período                                  3.7
TOTAL PATRIMONIO

TOTAL PASIVOS + PATRIMONIO
```

---

### 2. Estado de Resultado Integral (ERI)

El ERI tiene dos secciones. NIC 1 permite presentarlo en 1 estado o 2 estados separados:

```
SECCIÓN A — RESULTADO DEL PERÍODO

Ingresos de actividades ordinarias (NIIF 15)             4.1
(-) Costo de ventas / Costo de producción               5.1
GANANCIA BRUTA

(-) Gastos de ventas y distribución                     5.2
(-) Gastos de administración                            5.3
Otros ingresos operacionales                            4.2
RESULTADO DE OPERACIÓN (EBIT)

Ingresos financieros (NIIF 9)                           4.3
(-) Gastos financieros — intereses deuda                5.4
(-) Gastos financieros — intereses arrendamiento        5.5   ← NIIF 16: separar
(-) Deterioro de activos financieros (NIIF 9)           5.6
Otros ingresos / (gastos) — neto                        4.4
RESULTADO ANTES DE IMPUESTOS

(-) Participación trabajadores 15% (Código Trabajo EC)
(-) Gasto por impuesto a las ganancias (NIC 12)
RESULTADO DEL PERÍODO

SECCIÓN B — OTRO RESULTADO INTEGRAL (ORI)

Partidas que NO se reclasifican al resultado:
  Ganancias/(pérdidas) actuariales — NIC 19
  Superávit de revaluación PPE — NIC 16

Partidas que SÍ se reclasifican al resultado:
  Cobertura de flujos de efectivo — NIIF 9
  Diferencias de conversión

TOTAL OTRO RESULTADO INTEGRAL

RESULTADO INTEGRAL TOTAL DEL PERÍODO
```

---

### 3. Estado de Cambios en el Patrimonio (ECP)

```
Tabla con columnas:
Capital | Prima | Reservas | ORI | Resultados acum. | TOTAL

Filas obligatorias:
  Saldo al inicio del período anterior
  Cambios por reexpresión/corrección de errores (NIC 8)
  Resultado integral del período anterior
  Saldo al inicio del período actual
  Resultado integral del período actual
  Dividendos declarados
  Emisión de capital
  Otros movimientos
  SALDO AL FINAL DEL PERÍODO
```

---

### 4. Estado de Flujos de Efectivo (EFE) — método indirecto

```
ACTIVIDADES DE OPERACIÓN
  Resultado antes de impuestos
  Ajustes (no generan flujo de caja):
    + Depreciación PPE (NIC 16)
    + Depreciación activos por derecho de uso (NIIF 16)   ← NUEVO
    + Amortización activos intangibles
    + Deterioro de activos
    ± Variación provisiones
    ± Ganancias/pérdidas en venta de activos
  Cambios en capital de trabajo:
    (Aumento)/Disminución cuentas por cobrar
    (Aumento)/Disminución inventarios
    Aumento/(Disminución) cuentas por pagar
  (-) Impuesto a las ganancias pagado
  FLUJO NETO DE OPERACIÓN

ACTIVIDADES DE INVERSIÓN
  Adquisición de PPE
  Ingresos por venta de PPE
  Adquisición de activos intangibles
  FLUJO NETO DE INVERSIÓN

ACTIVIDADES DE FINANCIAMIENTO
  Préstamos recibidos
  Repago de préstamos
  Pago de principal arrendamientos (NIIF 16)              ← NUEVO: va aquí
  Pago de intereses arrendamientos (NIIF 16)              ← NUEVO: va aquí
  Dividendos pagados
  FLUJO NETO DE FINANCIAMIENTO

VARIACIÓN NETA EN EFECTIVO Y EQUIVALENTES
+ Efectivo al inicio del período
= EFECTIVO AL FINAL DEL PERÍODO
```

---

## Impacto de NIIF 16 en métricas (importante)

NIIF 16 capitaliza los arriendos operativos. Muchas métricas cambian:

```typescript
// src/lib/niif16.ts

// Calcular AMBAS versiones para comparabilidad histórica:
const ebitda_con_niif16   = ebit + depPPE + depDerechoUso + amortizacion
const ebitda_sin_niif16   = ebit + depPPE + amortizacion + gastosArriendoOperativo

// Deuda neta incluye pasivos por arrendamiento bajo NIIF 16:
const deudaNeta = deudaFinanciera + pasivosArrendamiento - efectivo

// SIEMPRE indicar en UI si el ratio usa "NIIF 16" o "pre-NIIF 16"
```

---

## Tipos TypeScript

```typescript
export type NiifFramework = 'full' | 'smes'  // NIIF Completas o NIIF para PYMES

export interface FinancialStatementHeader {
  companyName: string
  ruc: string
  period: { year: number; month: number }
  comparativePeriod: { year: number; month: number }  // NIC 1: siempre período anterior
  niifFramework: NiifFramework
  functionalCurrency: 'USD'
  preparedBy: string
  reviewedBy?: string
  generatedAt: Date
  isDraft: boolean
}

export interface OtherComprehensiveIncome {
  actuarialGainsLosses: number
  revaluationSurplus: number
  hedgingReserve: number
  translationDifferences: number
  total: number
}
```

---

## Reglas de presentación — UI y PDF

- Usar **siempre** los nombres NIIF: ESF, ERI, ECP, EFE — nunca "Balance" o "P&G"
- NIC 1 exige período comparativo: mostrar columna año actual + columna año anterior
- El ERI tiene dos secciones claramente separadas con subtotales
- Anotar `(NIIF 16)` junto a líneas de arrendamiento para transparencia
- El ECP se diseña como tabla de doble entrada — Tailwind `overflow-x-auto` en mobile
- Notas numeradas y referenciadas desde cada línea del ESF/ERI
- Versión borrador: marca de agua "BORRADOR" en diagonal en PDFs
