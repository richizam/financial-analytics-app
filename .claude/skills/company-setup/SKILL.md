---
name: company-setup
description: Configurar una nueva empresa en el sistema. Activar cuando se cree una empresa, se modifiquen sus datos base, o se necesite determinar qué marco NIIF aplica, qué estados financieros mostrar, qué ratios son relevantes para su industria, y qué módulos habilitar.
---

# Company Setup Skill

## Cuándo se activa
- Crear una nueva empresa en el sistema
- Modificar la configuración base de una empresa existente
- Determinar qué marco normativo y módulos aplican
- Construir el formulario de onboarding

---

## Preguntas de onboarding (orden obligatorio)

El sistema hace estas preguntas en secuencia. Cada respuesta condiciona las siguientes.
Implementar como wizard de pasos — nunca como un formulario largo.

---

### PASO 1 — Identidad legal

```typescript
interface CompanyIdentity {
  razonSocial: string           // Razón social completa
  nombreComercial?: string      // Nombre comercial (opcional)
  ruc: string                   // RUC (13 dígitos, validar módulo 11)
  tipoContribuyente:
    | 'sociedad'                // S.A., Cía. Ltda., etc.
    | 'persona_natural_obligada'// Persona natural obligada a llevar contabilidad
    | 'persona_natural_no_obligada' // Régimen simplificado
  representanteLegal: string
  correoContacto: string
  telefonoContacto?: string
}
```

**Validación RUC Ecuador:**
```typescript
function validarRUC(ruc: string): boolean {
  if (!/^\d{13}$/.test(ruc)) return false
  // Dígito verificador según tipo (persona natural, sociedad, sector público)
  const provincia = parseInt(ruc.substring(0, 2))
  if (provincia < 1 || provincia > 24) return false
  const tercerDigito = parseInt(ruc[2])
  if (tercerDigito === 6) return validarRUCSectorPublico(ruc)
  if (tercerDigito === 9) return validarRUCSociedad(ruc)
  return validarRUCPersonaNatural(ruc)
}
```

---

### PASO 2 — Tamaño y clasificación (determina el marco NIIF)

Preguntar los **3 criterios de clasificación SCVS** (Resolución No. SCVS-INC-DNCDN-2021-0021):

```typescript
interface CompanySize {
  activosTotalesUSD: number     // Activos totales al cierre del último ejercicio
  ingresosUSD: number           // Ingresos brutos anuales del último ejercicio
  numeroEmpleados: number       // Promedio de empleados del último año
}

// Clasificación automática según los 3 criterios:
function clasificarEmpresa(size: CompanySize): CompanyClassification {
  const { activosTotalesUSD: activos, ingresosUSD: ingresos, numeroEmpleados: empleados } = size

  // Grande: cumple AL MENOS 2 de 3 criterios
  if (
    [activos > 5_000_000, ingresos > 5_000_000, empleados > 200]
      .filter(Boolean).length >= 2
  ) return 'grande'

  // Mediana: cumple AL MENOS 2 de 3
  if (
    [activos > 1_000_000, ingresos > 1_000_000, empleados > 50]
      .filter(Boolean).length >= 2
  ) return 'mediana'

  // Pequeña: cumple AL MENOS 2 de 3
  if (
    [activos > 100_000, ingresos > 100_000, empleados > 10]
      .filter(Boolean).length >= 2
  ) return 'pequena'

  return 'microempresa'
}

type CompanyClassification = 'grande' | 'mediana' | 'pequena' | 'microempresa'
```

**Marco NIIF resultante:**
```typescript
function determinarMarcoNIIF(
  clasificacion: CompanyClassification,
  cotizaEnBolsa: boolean,
  esEntidadFinanciera: boolean,
  tieneObligacionPublica: boolean  // deuda/acciones en mercados públicos
): NiifFramework {

  // NIIF Completas obligatorio si:
  if (cotizaEnBolsa || esEntidadFinanciera || tieneObligacionPublica || clasificacion === 'grande') {
    return 'niif_completas'
  }

  // NIIF para PYMES: medianas y pequeñas sin obligación pública
  if (clasificacion === 'mediana' || clasificacion === 'pequena') {
    return 'niif_pymes'
  }

  // Microempresas: régimen simplificado (RIMPE) — contabilidad básica
  return 'rimpe'
}

type NiifFramework = 'niif_completas' | 'niif_pymes' | 'rimpe'
```

---

### PASO 3 — Régimen tributario (SRI)

```typescript
type RegimenTributario =
  | 'general'                   // Régimen General — la mayoría de empresas
  | 'rimpe_microempresa'        // RIMPE Microempresa (ingresos < $300K)
  | 'rimpe_negocio_popular'     // RIMPE Negocio Popular (ingresos < $20K)
  | 'regimen_especial'          // Cooperativas, fundaciones, ONG

interface TributaryConfig {
  regimen: RegimenTributario
  obligadoContabilidad: boolean
  agenteRetencion: boolean      // ¿Es agente de retención del IVA/IR?
  contribuyenteEspecial: boolean
  resolucionContribuyenteEspecial?: string
  llevaContabilidadDesde?: Date // Fecha desde que lleva contabilidad
}
```

**Impacto en la app:**
- `rimpe_negocio_popular` → deshabilitar módulo de auditoría, simplificar estados financieros
- `contribuyenteEspecial` → mostrar alertas de retenciones especiales
- `agenteRetencion` → habilitar módulo de comprobantes de retención

---

### PASO 4 — Sector económico e industria

```typescript
type SectorEconomico =
  | 'comercial'           // Compra-venta de mercadería
  | 'servicios'           // Prestación de servicios
  | 'industrial'          // Producción/manufactura
  | 'construccion'        // Construcción e inmobiliaria
  | 'agricola'            // Agricultura, ganadería, pesca
  | 'financiero'          // Financiero (cooperativas, casas de cambio)
  | 'salud'               // Clínicas, consultorios, farmacias
  | 'educacion'           // Instituciones educativas
  | 'tecnologia'          // Software, telecomunicaciones
  | 'transporte'          // Transporte y logística
  | 'minero_petroleo'     // Minería, petróleo, gas
  | 'otro'

// El sector determina:
// 1. Qué ratios son relevantes y sus benchmarks
// 2. Si maneja inventarios (comercial, industrial, agrícola)
// 3. Si tiene activos de larga duración (industrial, construcción)
// 4. Qué cuentas del plan de cuentas activar
```

**Benchmarks por sector (referencias Ecuador — actualizar anualmente):**

```typescript
const SECTOR_BENCHMARKS: Record<SectorEconomico, RatioBenchmarks> = {
  comercial: {
    margenBruto:      { alerta: 0.10, normal: 0.20, bueno: 0.35 },
    margenNeto:       { alerta: 0.02, normal: 0.05, bueno: 0.10 },
    razonCorriente:   { alerta: 1.0,  normal: 1.3,  bueno: 1.8  },
    rotacionInventario: { alerta: 90, normal: 45, bueno: 30 },  // días
  },
  servicios: {
    margenBruto:      { alerta: 0.30, normal: 0.45, bueno: 0.60 },
    margenNeto:       { alerta: 0.05, normal: 0.12, bueno: 0.20 },
    razonCorriente:   { alerta: 1.0,  normal: 1.5,  bueno: 2.0  },
    rotacionInventario: null,  // No aplica para servicios puros
  },
  industrial: {
    margenBruto:      { alerta: 0.15, normal: 0.28, bueno: 0.40 },
    margenNeto:       { alerta: 0.03, normal: 0.07, bueno: 0.15 },
    razonCorriente:   { alerta: 1.1,  normal: 1.5,  bueno: 2.0  },
    rotacionInventario: { alerta: 120, normal: 60, bueno: 30 },
  },
  construccion: {
    margenBruto:      { alerta: 0.12, normal: 0.22, bueno: 0.35 },
    margenNeto:       { alerta: 0.04, normal: 0.08, bueno: 0.15 },
    razonCorriente:   { alerta: 1.2,  normal: 1.6,  bueno: 2.2  },
  },
  // ... completar los demás sectores
}
```

---

### PASO 5 — Configuración contable y operativa

```typescript
interface AccountingConfig {
  // Período fiscal
  mesInicioEjercicio: 1 | number  // Casi siempre enero (1) en Ecuador
  // Moneda (siempre USD en Ecuador, pero preparar para multi-moneda)
  monedaFuncional: 'USD'

  // ¿Qué módulos aplican a esta empresa?
  tieneInventarios: boolean         // Activa módulo NIC 2
  tieneActijosFijos: boolean        // Activa módulo NIC 16
  tieneArrendamientos: boolean      // Activa módulo NIIF 16
  tieneBeneficiosEmpleados: boolean // Activa módulo NIC 19
  tieneInstrumentosFinancieros: boolean // Activa módulo NIIF 9
  tieneMonedaExtranjera: boolean    // Activa módulo NIC 21
  tieneSubsidiarias: boolean        // Activa consolidación (NIIF 10)

  // Políticas contables
  metodoInventarios: 'promedio_ponderado' | 'fifo' | null
  metodoDepreciacion: 'lineal' | 'unidades_produccion' | 'saldo_decreciente'
  modeloMedicionPPE: 'costo' | 'revaluacion'  // NIC 16
}
```

---

### PASO 6 — Fuentes de datos

```typescript
interface DataSourceConfig {
  fuentePrincipal: 'excel' | 'powerbi' | 'ambos'

  excel?: {
    formatoEsperado: 'balance_pyg' | 'libro_mayor' | 'personalizado'
    periodoActualizacion: 'mensual' | 'trimestral' | 'anual'
  }

  powerbi?: {
    workspaceId: string
    datasetId: string
    // Las credenciales van en variables de entorno — nunca aquí
  }
}
```

---

## Esquema Prisma — tabla Company

```prisma
model Company {
  id                    String             @id @default(cuid())
  razonSocial           String
  nombreComercial       String?
  ruc                   String             @unique
  tipoContribuyente     TipoContribuyente
  clasificacion         CompanyClass
  niifFramework         NiifFramework
  regimenTributario     RegimenTributario
  sector                SectorEconomico
  agenteRetencion       Boolean            @default(false)
  contribuyenteEspecial Boolean            @default(false)

  // Config contable
  mesInicioEjercicio    Int                @default(1)
  monedaFuncional       String             @default("USD")
  tieneInventarios      Boolean            @default(false)
  tieneActivosFijos     Boolean            @default(true)
  tieneArrendamientos   Boolean            @default(false)
  metodoInventarios     MetodoInventario?
  metodoDepreciacion    MetodoDepreciacion @default(lineal)
  modeloMedicionPPE     ModeloPPE          @default(costo)

  // Fuentes de datos
  fuenteDatos           FuenteDatos
  pbiWorkspaceId        String?
  pbiDatasetId          String?

  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt
  active                Boolean            @default(true)

  // Relaciones
  users                 UserCompany[]
  periods               FinancialPeriod[]
  importLogs            ImportLog[]
  anomalyReports        AnomalyReport[]
}

enum NiifFramework {
  niif_completas
  niif_pymes
  rimpe
}

enum CompanyClass {
  grande
  mediana
  pequena
  microempresa
}

enum SectorEconomico {
  comercial
  servicios
  industrial
  construccion
  agricola
  financiero
  salud
  educacion
  tecnologia
  transporte
  minero_petroleo
  otro
}
```

---

## Lógica de módulos activos por configuración

```typescript
// src/lib/company-modules.ts

export function getActiveModules(company: Company): ActiveModules {
  return {
    // Estados financieros
    estadoSituacion:    true,   // Siempre
    estadoResultados:   true,   // Siempre
    estadoCambiosPatrimonio: company.niifFramework !== 'rimpe',
    estadoFlujos:       company.niifFramework !== 'rimpe',
    notasEEFF:          company.niifFramework !== 'rimpe',

    // Módulos contables
    inventarios:        company.tieneInventarios,
    activosFijos:       company.tieneActivosFijos,
    arrendamientos:     company.tieneArrendamientos,  // NIIF 16
    niif16:             company.tieneArrendamientos && company.niifFramework === 'niif_completas',

    // Ratios
    ratiosInventario:   company.tieneInventarios && company.sector !== 'servicios',
    ratiosArrendamiento: company.tieneArrendamientos,
    benchmarkSector:    true,  // Siempre mostrar benchmark del sector

    // Funcionalidades
    deteccionAnomalias: company.niifFramework !== 'rimpe',
    exportacionPDF:     true,
    multiperiodo:       true,
  }
}
```

---

## UI del wizard de onboarding

```
Paso 1/6  Identidad legal
  [Razón social] [RUC] [Tipo contribuyente]

Paso 2/6  Tamaño de la empresa
  "Para determinar qué norma NIIF aplica necesitamos estos datos del último año:"
  [Activos totales $] [Ingresos brutos $] [N° empleados]
  → Resultado automático: "Esta empresa aplica NIIF para PYMES" ✓

Paso 3/6  Régimen tributario
  [Régimen] [¿Agente de retención?] [¿Contribuyente especial?]

Paso 4/6  Sector económico
  [Selector de sector] → muestra descripción y ratios que se activarán

Paso 5/6  Configuración contable
  Mostrar solo las preguntas relevantes según pasos anteriores:
  - Si sector = comercial/industrial: ¿Qué método de inventarios?
  - Si tiene activos fijos: ¿Modelo de medición PPE?
  - ¿Tiene contratos de arrendamiento? → activa NIIF 16

Paso 6/6  Fuente de datos
  [Excel / Power BI / Ambos] → configura el conector correspondiente

Pantalla final: resumen de configuración + botón "Crear empresa"
```

---

## Resumen de configuración (mostrar al finalizar)

```
✓ Empresa: Distribuidora XYZ S.A.
✓ RUC: 0990123456001
✓ Clasificación: Mediana empresa
✓ Marco NIIF: NIIF para PYMES
✓ Régimen tributario: General — Agente de retención
✓ Sector: Comercial
✓ Estados financieros: ESF · ERI · ECP · EFE · Notas
✓ Módulos activos: Inventarios (Promedio ponderado) · Activos fijos
✓ Fuente de datos: Excel (formato Balance + P&L)
✓ Ratios de inventario activados · Benchmark sector comercial cargado
```
