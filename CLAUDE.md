# Financial Analytics App — Contexto del proyecto

## Stack tecnológico
- **Frontend + Backend:** Next.js 14+ (App Router) con TypeScript
- **Base de datos:** PostgreSQL con Prisma ORM
- **Autenticación:** NextAuth.js con roles
- **UI / Gráficos:** Tailwind CSS + Recharts + Tremor
- **Excel:** biblioteca `xlsx` (SheetJS)
- **Power BI:** Power BI REST API v2.0
- **Deploy:** Vercel (frontend) + Railway/Supabase (DB)

## Estructura de carpetas
```
src/
├── app/                  # Next.js App Router
│   ├── (auth)/           # login, registro
│   ├── (dashboard)/      # vistas protegidas
│   │   ├── overview/     # resumen ejecutivo
│   │   ├── reports/      # informes contables
│   │   ├── anomalies/    # detección de anomalías
│   │   └── admin/        # gestión de usuarios
│   └── api/              # API routes
│       ├── auth/
│       ├── metrics/
│       ├── connectors/
│       └── reports/
├── components/
│   ├── charts/           # componentes de gráficos
│   ├── tables/           # tablas financieras
│   └── ui/               # componentes base
├── lib/
│   ├── prisma.ts
│   ├── powerbi.ts
│   └── excel.ts
└── types/
    └── financial.ts      # tipos TypeScript para datos financieros
```

## Convenciones obligatorias
- TypeScript estricto: `strict: true` en tsconfig — sin `any` implícito
- Todos los montos en **centavos (integer)** internamente, nunca floats
- Fechas en **ISO 8601** (YYYY-MM-DD) en BD, formato local solo en UI
- Nombres de variables en **inglés**, textos UI en **español**
- Componentes: PascalCase. Funciones/hooks: camelCase. Constantes: UPPER_SNAKE
- Cada API route valida con **Zod** antes de procesar
- Errores financieros se loguean SIEMPRE — nunca silenciar con catch vacío

## Arquitectura multi-empresa
- La app gestiona **N empresas** — todo dato está aislado por `companyId`
- Cada empresa tiene su propio marco NIIF, sector, y módulos activos
- Un usuario puede tener roles distintos en distintas empresas
- La empresa activa se lee de la sesión JWT — nunca asumir una sola empresa
- Ver skill `company-setup` para el wizard de onboarding y clasificación

## Normas contables aplicables (Ecuador)
- **3 marcos posibles** según tamaño y tipo de empresa (ver skill `company-setup`):
  - `niif_completas` — empresas grandes, cotizadas, entidades financieras (SCVS)
  - `niif_pymes` — medianas y pequeñas sin obligación pública de rendir cuentas
  - `rimpe` — microempresas bajo régimen simplificado del SRI
- Ente regulador: Superintendencia de Compañías, Valores y Seguros (SCVS)
- NIIF 16 afecta EBITDA y balance — calcular siempre ambas versiones
- Moneda funcional y de presentación: USD (dolarización)
- **Nunca hardcodear el marco NIIF** — leerlo siempre desde `company.niifFramework`

## Roles de usuario
| Rol | Acceso |
|-----|--------|
| `admin` | Todo, gestión de usuarios |
| `contador` | Lectura + carga de datos + reportes |
| `auditor` | Solo lectura, exportación |
| `gerente` | Dashboard ejecutivo, sin detalle de asientos |

## Componentes estables — NO modificar sin revisar este archivo
> Actualizar esta sección cada vez que un componente quede estable.

| Componente | Ruta | Estado | Notas |
|---|---|---|---|
| Parser CSV | src/lib/parser.ts | ESTABLE | Lee YYYYMM.csv y saldos_iniciales_YYYY.csv; cierreAnual(); montos en centavos |
| Estados financieros | src/lib/statements.ts | ESTABLE | generarESF(), generarERI(); cascade PT 15% → IR 25%; clasificarCuenta() |
| Métricas y ratios | src/lib/metrics.ts | ESTABLE | calcularMetricas(); semáforos por sector; safeDiv() para div/0 |
| Formateo | src/lib/format.ts | ESTABLE | fmtMoneda, fmtPct, fmtVeces, fmtDias, fmtPeriodo, fmtCompacto |

## Archivos de datos — NUNCA modificar automáticamente
- `data/empresas/[RUC]/saldos_iniciales_*.csv` → solo el contador
- `data/empresas/[RUC]/[YYYYMM].csv` → solo el contador

Si los datos parecen incorrectos, mostrar advertencia en UI pero nunca corregir el archivo directamente.

## Archivos que NO modificar sin confirmación explícita

| Archivo | Estado | Razón |
|---|---|---|
| src/lib/statements.ts | ESTABLE | ESF y ERI calculan correctamente |
| src/lib/metrics.ts | ESTABLE | Ratios y semáforos funcionan |
| src/app/page.tsx | ESTABLE | Dashboard y visualizaciones OK |
| src/components/statements/ERIView.tsx | ESTABLE | Badges estimado funcionan |

## Regla general
Antes de modificar cualquier archivo, leer CLAUDE.md.
Si el archivo está marcado ESTABLE, solo tocarlo si el usuario lo autoriza explícitamente en el prompt.
Si el bug está en parser.ts, corregir SOLO parser.ts.

## Antipatrones — nunca hacer esto
- No usar `useEffect` para fetch de datos — usar React Server Components o SWR
- No hardcodear credenciales — siempre desde `.env.local`
- No mezclar lógica de negocio en componentes UI
- No redondear montos con `Math.round` — usar función `roundFinancial()` de `/lib/math.ts`
- No modificar componentes marcados como ESTABLE sin aprobación explícita

## Comandos útiles del proyecto
```bash
npm run dev          # desarrollo
npm run build        # producción
npm run db:migrate   # migraciones Prisma
npm run db:seed      # datos de prueba
npm run test         # Jest
```

## Skills activas
Ver `.claude/skills/` — cada una se activa automáticamente según contexto.
