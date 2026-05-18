---
name: financial-metrics
description: Calcular e interpretar métricas contables y financieras. Activar cuando se trabajen ratios, P&L, balance general, flujo de caja, EBITDA, ROE, ROA, análisis de rentabilidad, liquidez o endeudamiento.
---

# Financial Metrics Skill

## Cuándo se activa esta skill
- Crear o editar funciones de cálculo de ratios financieros
- Construir componentes de P&L, Balance General, Flujo de Caja
- Implementar KPIs del dashboard principal
- Interpretar resultados para mostrar al usuario

## Métricas que maneja esta app

### Rentabilidad
```typescript
// Margen bruto
margenBruto = (utilidadBruta / ventasNetas) * 100

// Margen neto
margenNeto = (utilidadNeta / ventasNetas) * 100

// EBITDA bajo NIIF 16 (incluye depreciación de activos por derecho de uso)
ebitda_niif16  = utilidadOperacional + depreciacionPPE + depreciacionDerechoUso + amortizacion

// EBITDA pre-NIIF 16 (para comparar con períodos anteriores)
ebitda_pre_niif = utilidadOperacional + depreciacionPPE + amortizacion + gastosArriendoOperativo

// SIEMPRE indicar en UI cuál versión se muestra

// ROE — Retorno sobre patrimonio
roe = (utilidadNeta / patrimonioPromedio) * 100

// ROA — Retorno sobre activos
roa = (utilidadNeta / activosTotalesPromedio) * 100

// ROCE — Retorno sobre capital empleado
roce = (ebit / (activosTotales - pasivosCorrientes)) * 100
```

### Liquidez
```typescript
// Razón corriente
razonCorriente = activosCorrientes / pasivosCorrientes
// Alerta: < 1.0 riesgo crítico | 1.0-1.5 atención | > 1.5 saludable

// Prueba ácida
pruebaAcida = (activosCorrientes - inventarios) / pasivosCorrientes

// Capital de trabajo neto
capitalTrabajo = activosCorrientes - pasivosCorrientes
```

### Endeudamiento
```typescript
// Razón de endeudamiento
razonEndeudamiento = pasivosTotales / activosTotales

// Apalancamiento financiero
apalancamiento = activosTotales / patrimonioNeto

// Cobertura de intereses
coberturaIntereses = ebit / gastoIntereses
// Alerta: < 1.5 riesgo | 1.5-3 atención | > 3 saludable

// DSCR — Cobertura de deuda
dscr = (ebitda - capex) / (principalDeuda + intereses)
```

### Eficiencia
```typescript
// Rotación de cartera (días)
rotacionCartera = (cuentasCobrar / ventasNetas) * 365

// Rotación de inventarios (días)
rotacionInventarios = (inventarios / costoVentas) * 365

// Rotación de proveedores (días)
rotacionProveedores = (cuentasPagar / compras) * 365

// Ciclo de conversión de efectivo
cce = rotacionCartera + rotacionInventarios - rotacionProveedores
```

## Estructura de tipos TypeScript

```typescript
// src/types/financial.ts
export interface FinancialPeriod {
  year: number
  month: number        // 1-12
  quarter: 1 | 2 | 3 | 4
}

export interface BalanceSheet {
  period: FinancialPeriod
  // Activos (en centavos)
  cashAndEquivalents: number
  accountsReceivable: number
  inventory: number
  currentAssets: number
  fixedAssets: number
  totalAssets: number
  // Pasivos
  accountsPayable: number
  shortTermDebt: number
  currentLiabilities: number
  longTermDebt: number
  totalLiabilities: number
  // Patrimonio
  equity: number
}

export interface IncomeStatement {
  period: FinancialPeriod
  revenue: number
  costOfGoods: number
  grossProfit: number
  operatingExpenses: number
  ebitda: number
  depreciation: number
  ebit: number
  interestExpense: number
  taxExpense: number
  netIncome: number
}

export interface FinancialRatios {
  period: FinancialPeriod
  // Rentabilidad
  grossMargin: number
  netMargin: number
  ebitdaMargin: number
  roe: number
  roa: number
  // Liquidez
  currentRatio: number
  quickRatio: number
  workingCapital: number
  // Endeudamiento
  debtRatio: number
  leverage: number
  interestCoverage: number
  // Eficiencia (días)
  dso: number    // Days Sales Outstanding
  dio: number    // Days Inventory Outstanding
  dpo: number    // Days Payable Outstanding
  ccc: number    // Cash Conversion Cycle
}
```

## Semáforos de alerta estándar

```typescript
// src/lib/alerts.ts
export function getRatioStatus(metric: string, value: number): 'green' | 'yellow' | 'red' {
  const thresholds = {
    currentRatio:      { red: 1.0,  yellow: 1.5  },
    quickRatio:        { red: 0.7,  yellow: 1.0  },
    debtRatio:         { red: 0.7,  yellow: 0.5  },  // invertido: más alto = peor
    interestCoverage:  { red: 1.5,  yellow: 3.0  },
    grossMargin:       { red: 0.15, yellow: 0.25 },
    netMargin:         { red: 0.02, yellow: 0.08 },
  }
  // Implementar lógica según tipo de industria del cliente
}
```


## Ratios activos según configuración de empresa

> Leer `company` antes de calcular — no todos los ratios aplican a todas las empresas.

```typescript
// src/lib/metrics/active-ratios.ts
export function getActiveRatios(company: Company): string[] {
  const ratios = ['margenBruto', 'margenNeto', 'ebitda', 'roe', 'roa',
                  'razonCorriente', 'pruebaAcida', 'razonEndeudamiento',
                  'coberturaIntereses']

  // Solo si tiene inventarios (comercial, industrial, agrícola)
  if (company.tieneInventarios) {
    ratios.push('rotacionInventarios', 'diasInventario')
  }

  // Solo si tiene arrendamientos (NIIF 16)
  if (company.tieneArrendamientos) {
    ratios.push('ebitda_niif16', 'deudaNetaConArrendamientos')
  }

  // Solo si tiene cartera de clientes
  ratios.push('rotacionCartera', 'diasCobro', 'rotacionProveedores', 'diasPago')

  // CCE solo si tiene inventarios Y cartera
  if (company.tieneInventarios) {
    ratios.push('cicloConversionEfectivo')
  }

  return ratios
}
```

## Benchmarks según sector y tamaño

> Los umbrales de semáforo cambian según `company.sector`.
> Ver skill `company-setup` para los valores por sector.

```typescript
// src/lib/metrics/benchmarks.ts
import { SECTOR_BENCHMARKS } from '@/skills/company-setup'

export function getRatioStatus(
  metric: string,
  value: number,
  company: Company
): 'green' | 'yellow' | 'red' {
  const benchmarks = SECTOR_BENCHMARKS[company.sector]
  const threshold = benchmarks?.[metric]
  if (!threshold) return 'gray'  // ratio no aplica al sector

  // Para ratios donde más alto es peor (endeudamiento, días de cobro):
  const invertidos = ['razonEndeudamiento', 'diasCobro', 'diasInventario', 'diasPago', 'cce']
  if (invertidos.includes(metric)) {
    if (value <= threshold.bueno)  return 'green'
    if (value <= threshold.normal) return 'yellow'
    return 'red'
  }
  // Para ratios donde más alto es mejor:
  if (value >= threshold.bueno)  return 'green'
  if (value >= threshold.normal) return 'yellow'
  return 'red'
}
```

## Reglas de cálculo críticas
- Siempre usar promedios de inicio+fin de período para ratios de rotación
- EBITDA bajo NIIF 16 = Utilidad Operacional + Dep.PPE + Dep.Derecho de Uso + Amortización
- SIEMPRE calcular ambas versiones de EBITDA (con y sin NIIF 16) para comparabilidad
- En períodos mensuales, anualizar multiplicando por (12/meses_transcurridos)
- Nunca dividir por cero — retornar `null` y mostrar "N/D" en UI
- Comparar siempre vs período anterior Y vs benchmark de industria si disponible

## Formato de presentación
- Porcentajes: 1 decimal (23.4%)
- Ratios: 2 decimales (1.85x)
- Montos: separador de miles, 2 decimales ($1,234,567.89)
- Variaciones: mostrar flecha ↑↓ y color verde/rojo según si mejora o empeora
