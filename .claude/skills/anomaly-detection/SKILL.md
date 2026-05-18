---
name: anomaly-detection
description: Detectar anomalías, irregularidades y patrones sospechosos en datos contables y financieros. Activar cuando se trabajen algoritmos de detección de fraude, análisis de Benford, duplicados, outliers estadísticos, o alertas automáticas de auditoría.
---

# Anomaly Detection Skill

## Cuándo se activa
- Implementar análisis de Benford's Law
- Detectar asientos duplicados o sospechosos
- Identificar outliers estadísticos en cuentas
- Construir el módulo de alertas automáticas
- Analizar patrones inusuales en transacciones

## Técnicas implementadas en esta app

### 1. Análisis de Benford's Law
Detecta manipulación de datos verificando la distribución del primer dígito.

```typescript
// src/lib/anomalies/benford.ts

// Distribución esperada de Benford (primer dígito 1-9)
const BENFORD_EXPECTED: Record<number, number> = {
  1: 0.301, 2: 0.176, 3: 0.125, 4: 0.097,
  5: 0.079, 6: 0.067, 7: 0.058, 8: 0.051, 9: 0.046,
}

export function analyzeBenford(amounts: number[]): BenfordResult {
  // 1. Filtrar montos > 0 y tomar primer dígito
  const digits = amounts
    .filter(a => a > 0)
    .map(a => parseInt(String(Math.abs(a))[0]))

  // 2. Calcular frecuencia observada
  const observed: Record<number, number> = {}
  digits.forEach(d => { observed[d] = (observed[d] ?? 0) + 1 })
  
  // 3. Chi-cuadrado para medir desviación
  const chiSquare = Object.entries(BENFORD_EXPECTED).reduce((sum, [digit, expected]) => {
    const obs = (observed[Number(digit)] ?? 0) / digits.length
    return sum + Math.pow(obs - expected, 2) / expected
  }, 0)

  // 4. p-value con 8 grados de libertad
  // chiSquare > 15.507 → p < 0.05 → sospechoso
  return {
    chiSquare,
    suspicious: chiSquare > 15.507,
    observed,
    expected: BENFORD_EXPECTED,
    sampleSize: digits.length,
    riskLevel: chiSquare > 20 ? 'high' : chiSquare > 15.507 ? 'medium' : 'low',
  }
}
```

### 2. Detección de duplicados
```typescript
// src/lib/anomalies/duplicates.ts

export function findDuplicateEntries(entries: JournalEntry[]): DuplicateGroup[] {
  // Criterios de duplicado (ordenados por riesgo):
  
  // Nivel 1 — Exacto: mismo monto + misma cuenta + misma fecha
  // Nivel 2 — Probable: mismo monto + misma cuenta + ±3 días
  // Nivel 3 — Posible: mismo monto + descripción similar (distancia Levenshtein < 0.2)
  
  const groups: DuplicateGroup[] = []
  
  // Agrupar por hash de (monto, cuenta, fecha±3días)
  const byAmountAndAccount = groupBy(entries, e => 
    `${e.amount}_${e.accountCode}_${Math.floor(e.date.getTime() / (3 * 24 * 3600 * 1000))}`
  )
  
  for (const [key, group] of Object.entries(byAmountAndAccount)) {
    if (group.length > 1) {
      groups.push({
        entries: group,
        type: 'probable-duplicate',
        riskScore: calculateDuplicateRisk(group),
      })
    }
  }
  
  return groups.sort((a, b) => b.riskScore - a.riskScore)
}
```

### 3. Outliers estadísticos por cuenta
```typescript
// src/lib/anomalies/outliers.ts

export function detectOutliers(
  transactions: Transaction[],
  method: 'iqr' | 'zscore' = 'iqr'
): OutlierResult[] {
  
  if (method === 'iqr') {
    // Rango intercuartil — más robusto para datos financieros asimétricos
    const sorted = transactions.map(t => t.amount).sort((a, b) => a - b)
    const q1 = sorted[Math.floor(sorted.length * 0.25)]
    const q3 = sorted[Math.floor(sorted.length * 0.75)]
    const iqr = q3 - q1
    const lower = q1 - 1.5 * iqr
    const upper = q3 + 1.5 * iqr
    
    return transactions
      .filter(t => t.amount < lower || t.amount > upper)
      .map(t => ({
        transaction: t,
        deviationType: t.amount > upper ? 'high' : 'low',
        deviationFactor: t.amount > upper 
          ? (t.amount - upper) / iqr 
          : (lower - t.amount) / iqr,
      }))
  }
  
  if (method === 'zscore') {
    // Z-score — útil cuando la distribución es aproximadamente normal
    const mean = transactions.reduce((s, t) => s + t.amount, 0) / transactions.length
    const std = Math.sqrt(
      transactions.reduce((s, t) => s + Math.pow(t.amount - mean, 2), 0) / transactions.length
    )
    return transactions
      .filter(t => Math.abs((t.amount - mean) / std) > 3)
      .map(t => ({ transaction: t, zScore: (t.amount - mean) / std }))
  }
}
```

### 4. Alertas automáticas de auditoría
```typescript
// src/lib/anomalies/audit-alerts.ts

// Reglas de alerta configurables
export const AUDIT_RULES: AuditRule[] = [
  {
    id: 'round-numbers',
    name: 'Montos redondos sospechosos',
    description: 'Transacciones con montos exactamente redondos (1000, 5000, 10000)',
    check: (entries) => entries.filter(e => e.amount % 1000 === 0 && e.amount > 500),
    riskLevel: 'low',
  },
  {
    id: 'end-of-period',
    name: 'Asientos de fin de período',
    description: 'Alta concentración de asientos en los últimos 3 días del mes',
    check: (entries, period) => {
      const lastDays = entries.filter(e => {
        const day = new Date(e.date).getDate()
        const lastDay = new Date(period.year, period.month, 0).getDate()
        return day >= lastDay - 2
      })
      return lastDays.length / entries.length > 0.3 ? lastDays : []
    },
    riskLevel: 'medium',
  },
  {
    id: 'unusual-accounts',
    name: 'Cuentas inusuales',
    description: 'Transacciones en cuentas con actividad atípica para el período',
    riskLevel: 'medium',
  },
  {
    id: 'split-transactions',
    name: 'Transacciones fraccionadas',
    description: 'Múltiples transacciones que suman un monto notable (posible evitar umbral)',
    riskLevel: 'high',
  },
  {
    id: 'negative-inventory',
    name: 'Inventario negativo',
    description: 'Saldo de inventario negativo en cualquier cuenta de existencias',
    riskLevel: 'high',
  },
]
```

## API Route de análisis
```typescript
// src/app/api/anomalies/analyze/route.ts
// POST con { periodId, analysisTypes: ['benford', 'duplicates', 'outliers', 'audit'] }
// Responde: { results, summary, riskScore, recommendations }
// Guardar resultado en tabla `anomaly_reports` para historial
```

## Componente de visualización
```tsx
// src/components/anomalies/AnomalyDashboard.tsx
// Secciones:
// 1. Score de riesgo general (0-100) con gauge chart
// 2. Resumen por tipo de anomalía (cards con conteo)
// 3. Gráfico de Benford (barras esperado vs observado)
// 4. Lista de transacciones sospechosas (tabla con drill-down)
// 5. Historial de análisis anteriores
```

## Criterio de prioridad de investigación
```
RIESGO ALTO (acción inmediata):
  - Benford chi² > 20
  - Duplicados exactos con monto > $1,000
  - Outliers con factor de desviación > 5
  - Inventario negativo

RIESGO MEDIO (revisar esta semana):
  - Benford chi² 15.5-20
  - Duplicados probables
  - Alta concentración fin de período > 30%

RIESGO BAJO (monitorear):
  - Montos redondos frecuentes
  - Cuentas con actividad inusual
  - Outliers leves (factor 2-5)
```
