---
name: data-connectors
description: Conectar y leer datos desde archivos Excel (.xlsx) y modelos de datos de Power BI. Activar cuando se trabaje con carga de archivos, lectura de hojas de cálculo, autenticación con Power BI, consultas DAX o sincronización de datasets.
---

# Data Connectors Skill

## Cuándo se activa
- Implementar carga de archivos Excel
- Conectar con Power BI REST API
- Parsear y normalizar datos financieros externos
- Crear pipelines de ingesta de datos

## Conector 1: Excel (.xlsx)

### Dependencias
```bash
npm install xlsx         # SheetJS — parseo de Excel
npm install zod          # validación de esquema
```

### Estructura esperada del Excel financiero
La app acepta dos formatos:

**Formato A — Balance + P&L en hojas separadas:**
```
Hoja "Balance"    → columnas: Cuenta | Código | Saldo_Mes | Saldo_Anterior
Hoja "PyG"        → columnas: Cuenta | Código | Mes_Actual | Mes_Anterior | Acumulado
Hoja "Flujo"      → columnas: Concepto | Operacional | Inversión | Financiamiento
```

**Formato B — Libro mayor plano (exportación contable):**
```
Hoja "LM"   → columnas: Fecha | Cuenta | Descripción | Debe | Haber | Saldo
```

### Implementación del parser

```typescript
// src/lib/excel.ts
import * as XLSX from 'xlsx'
import { z } from 'zod'

// Schema de validación para cada fila del Balance
const BalanceRowSchema = z.object({
  Cuenta: z.string().min(1),
  Código: z.string().regex(/^\d{1,6}(\.\d{2})*$/), // formato 1.01.01
  Saldo_Mes: z.number(),
  Saldo_Anterior: z.number().optional(),
})

export async function parseExcelFile(buffer: ArrayBuffer): Promise<ParseResult> {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  
  const errors: string[] = []
  const sheets: Record<string, unknown[]> = {}

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    // header:1 devuelve arrays; header con nombre devuelve objetos
    sheets[sheetName] = XLSX.utils.sheet_to_json(sheet, {
      defval: null,       // celdas vacías = null, no undefined
      raw: false,         // fechas como strings ISO
    })
  }

  return { sheets, errors }
}

// Normalizar código de cuenta a estructura jerárquica
export function normalizeAccountCode(code: string): AccountLevel {
  const parts = code.split('.')
  return {
    level1: parts[0],          // 1 = Activo
    level2: parts[1] ?? null,  // 01 = Activo Corriente
    level3: parts[2] ?? null,  // 01 = Caja y Bancos
    fullCode: code,
  }
}
```

### API Route para carga
```typescript
// src/app/api/connectors/excel/route.ts
export async function POST(request: Request) {
  // 1. Validar rol del usuario (solo contador y admin)
  // 2. Recibir FormData con el archivo
  // 3. Validar extensión y tamaño (max 10MB)
  // 4. Parsear con parseExcelFile()
  // 5. Validar esquema con Zod
  // 6. Insertar en BD con Prisma (upsert por período)
  // 7. Retornar resumen: filas procesadas, errores encontrados
}
```

---

## Conector 2: Power BI REST API

### Autenticación (Azure AD / Entra ID)
```typescript
// src/lib/powerbi.ts
// Variables de entorno requeridas:
// POWERBI_TENANT_ID
// POWERBI_CLIENT_ID
// POWERBI_CLIENT_SECRET
// POWERBI_WORKSPACE_ID

const TOKEN_URL = `https://login.microsoftonline.com/${process.env.POWERBI_TENANT_ID}/oauth2/v2.0/token`

export async function getPowerBIToken(): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.POWERBI_CLIENT_ID!,
      client_secret: process.env.POWERBI_CLIENT_SECRET!,
      scope: 'https://analysis.windows.net/powerbi/api/.default',
    }),
  })
  const data = await response.json()
  return data.access_token
}
```

### Lectura de datasets y ejecución de DAX
```typescript
const PBI_BASE = 'https://api.powerbi.com/v1.0/myorg'

// Listar datasets del workspace
export async function listDatasets(token: string) {
  const res = await fetch(
    `${PBI_BASE}/groups/${process.env.POWERBI_WORKSPACE_ID}/datasets`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  return res.json()
}

// Ejecutar consulta DAX contra un dataset
export async function executeDax(token: string, datasetId: string, daxQuery: string) {
  const res = await fetch(
    `${PBI_BASE}/groups/${process.env.POWERBI_WORKSPACE_ID}/datasets/${datasetId}/executeQueries`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        queries: [{ query: daxQuery }],
        serializerSettings: { includeNulls: true },
      }),
    }
  )
  return res.json()
}
```

### Consultas DAX estándar para métricas financieras
```dax
// Ingresos del período
EVALUATE
SUMMARIZECOLUMNS(
    'Fecha'[Año],
    'Fecha'[Mes],
    "Ingresos", [Total Ingresos],
    "CostoVentas", [Total Costo Ventas],
    "UtilidadBruta", [Utilidad Bruta]
)

// Balance General a una fecha
EVALUATE
CALCULATETABLE(
    SUMMARIZECOLUMNS(
        'PlanCuentas'[Nivel1],
        'PlanCuentas'[Cuenta],
        "Saldo", [Saldo Actual]
    ),
    'Fecha'[Fecha] <= DATE(2024, 12, 31)
)
```

## Flujo de datos recomendado
```
Excel / Power BI
      ↓
  API Route (Next.js)     ← valida, sanitiza
      ↓
  Prisma + PostgreSQL      ← persiste datos normalizados
      ↓
  React Server Components  ← lee desde BD (no directo desde Excel/PBI)
      ↓
  Dashboard UI
```

**Regla clave:** nunca leer Excel o Power BI directamente desde el cliente. Siempre pasar por la API route del servidor.

## Manejo de errores de conectores
- Excel con formato inesperado → retornar lista de errores por fila, no fallar silenciosamente
- Token Power BI expirado → refrescar automáticamente (TTL = 3600s)
- Dataset PBI no disponible → cachear último resultado exitoso con timestamp
- Columnas faltantes en Excel → registrar en tabla `import_logs` con detalle
