# Financial Analytics App — Contexto del proyecto

## Stack tecnológico
- **Frontend:** Next.js 14+ (App Router) con TypeScript
- **Backend:** Python FastAPI en `backend/`, consumido por Server Actions
- **Base de datos:** PostgreSQL via Python/psycopg, con fallback local a `data/empresas`
- **Autenticación:** NextAuth.js con roles
- **UI / Gráficos:** Tailwind CSS + Recharts + Tremor
- **Excel:** biblioteca `xlsx` (SheetJS)
- **Power BI:** Power BI REST API v2.0
- **Deploy:** Vercel (frontend) + servicio Python privado + Railway/Supabase (DB)

## Estructura de carpetas
```
backend/
├── app/
│   ├── api/              # rutas HTTP y dependencias FastAPI
│   ├── core/             # settings y seguridad backend-to-backend
│   ├── domain/financial/ # reglas contables y servicio financiero
│   ├── schemas/          # request schemas Pydantic
│   └── storage/          # adaptadores file/PostgreSQL
└── tests/

src/
├── app/                  # Next.js App Router + Server Actions proxy a Python
├── components/           # UI, charts, tables, dashboards
└── lib/                  # tipos frontend, formato, Excel, auth, proxy backend
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
| Parser CSV | backend/app/domain/financial/accounting.py | ESTABLE | Lee YYYYMM.csv y saldos_iniciales_YYYY.csv; montos en centavos |
| Estados financieros | backend/app/domain/financial/accounting.py | ESTABLE | generar_esf(), generar_eri(); cascade PT 15% → IR 25%; clasificar_cuenta() |
| Métricas y ratios | backend/app/domain/financial/accounting.py | ESTABLE | calcular_metricas(); semáforos por sector; safe div para div/0 |
| Formateo | src/lib/format.ts | ESTABLE | fmtMoneda, fmtPct, fmtVeces, fmtDias, fmtPeriodo, fmtCompacto |

## Archivos de datos — NUNCA modificar automáticamente
- `data/empresas/[RUC]/saldos_iniciales_*.csv` → solo el contador
- `data/empresas/[RUC]/[YYYYMM].csv` → solo el contador

Si los datos parecen incorrectos, mostrar advertencia en UI pero nunca corregir el archivo directamente.

## Archivos que NO modificar sin confirmación explícita

| Archivo | Estado | Razón |
|---|---|---|
| backend/app/domain/financial/accounting.py | ESTABLE | Parser, ESF/ERI, métricas y anomalías |
| src/lib/statements.ts | ESTABLE | Contratos TypeScript ESF/ERI consumidos por la UI |
| src/lib/metrics.ts | ESTABLE | Contratos TypeScript de ratios consumidos por la UI |
| src/app/page.tsx | ESTABLE | Dashboard y visualizaciones OK |
| src/components/statements/ERIView.tsx | ESTABLE | Badges estimado funcionan |

## Regla general
Antes de modificar cualquier archivo, leer CLAUDE.md.
Si el archivo está marcado ESTABLE, solo tocarlo si el usuario lo autoriza explícitamente en el prompt.
Si el bug está en cálculo financiero, corregir primero `backend/app/domain/financial/accounting.py` y mantener los contratos TypeScript sincronizados.

## Antipatrones — nunca hacer esto
- No usar `useEffect` para fetch de datos — usar React Server Components o SWR
- No hardcodear credenciales — siempre desde `.env.local`
- No mezclar lógica de negocio en componentes UI
- No redondear montos con floats — los montos van en **centavos (integer)** y el redondeo financiero se centraliza en `to_cents()` (Decimal/ROUND_HALF_UP) en `backend/app/domain/financial/accounting.py`
- No modificar componentes marcados como ESTABLE sin aprobación explícita

## Regla de builds
NUNCA ejecutar `npm run build` mientras el servidor de desarrollo está corriendo.
`npm run build` sobreescribe `.next/` y rompe el Tailwind JIT del servidor dev, dejando la app sin estilos CSS.
Para verificar TypeScript usar solo `npx tsc --noEmit` — no afecta el servidor.

## Comandos útiles del proyecto
```bash
npm run dev          # frontend Next.js (Tailwind JIT activo)
npm run dev:backend  # backend FastAPI en http://127.0.0.1:8000
npx tsc --noEmit     # verificar tipos sin tocar el servidor
python -m pytest backend/tests -q  # pruebas backend
npm run build        # producción — solo cuando el dev server está DETENIDO
npm run test         # pruebas backend (pytest)
```

## Skills activas
Ver `.claude/skills/` — cada una se activa automáticamente según contexto.
