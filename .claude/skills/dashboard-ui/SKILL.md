---
name: dashboard-ui
description: Construir interfaces de dashboard financiero con gráficos, KPIs, tablas y semáforos. Activar cuando se trabajen componentes visuales del dashboard, gráficos de Recharts, tarjetas de KPI, o cualquier elemento de la interfaz del panel principal.
---

# Dashboard UI Skill

## Cuándo se activa
- Crear o modificar componentes del dashboard
- Agregar gráficos financieros con Recharts
- Construir tarjetas de KPI
- Implementar tablas de datos financieros
- Diseñar layouts de reportes visuales

## Stack UI de este proyecto
- **Tailwind CSS** — utilidades de estilo
- **Recharts** — gráficos (no Chart.js, no D3 directo)
- **Tremor** — componentes financieros pre-built (@tremor/react)
- **Lucide React** — iconos
- **React Server Components** — fetch de datos, sin useEffect para data

## Paleta de colores financiera

```typescript
// src/lib/constants/colors.ts
export const FINANCIAL_COLORS = {
  // Semáforos
  green:  '#16a34a',  // saludable
  yellow: '#ca8a04',  // atención
  red:    '#dc2626',  // alerta

  // Gráficos (ordenar siempre así)
  chart: ['#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#0891b2'],

  // Variaciones
  positive: '#16a34a',   // ingresos/utilidad sube
  negative: '#dc2626',   // ingresos/utilidad baja
  neutral:  '#6b7280',

  // Fondo de secciones
  cardBg:   'bg-white dark:bg-gray-900',
  pageBg:   'bg-gray-50 dark:bg-gray-950',
}
```

## Componentes base del dashboard

### Tarjeta KPI
```tsx
// src/components/ui/KPICard.tsx
interface KPICardProps {
  title: string
  value: string           // ya formateado: "$1,234,567" o "23.4%"
  trend: number           // variación porcentual vs período anterior
  status: 'green' | 'yellow' | 'red'
  icon: LucideIcon
  subtitle?: string       // ej: "vs mes anterior"
}

// Layout: icono arriba-derecha, valor grande al centro, tendencia abajo
// Tendencia: flecha TrendingUp/TrendingDown + porcentaje con color
```

### Gráfico de barras comparativo (P&L mensual)
```tsx
// src/components/charts/PLChart.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Datos esperados:
// [{ mes: 'Ene', ingresos: 150000, costos: 90000, utilidad: 60000 }, ...]

// Siempre usar ResponsiveContainer con height fija (ej: 320)
// Tooltip personalizado que muestre valores en formato moneda
// Colores: ingresos=azul, costos=rojo suave, utilidad=verde
```

### Gráfico de líneas (tendencia)
```tsx
// src/components/charts/TrendChart.tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// Para series de tiempo: ratios, márgenes, flujo de caja
// Siempre mostrar punto de referencia/benchmark si existe
// Área sombreada opcional para rango saludable
```

### Tabla financiera con semáforos
```tsx
// src/components/tables/RatiosTable.tsx
// Columnas: Ratio | Valor Actual | Valor Anterior | Variación | Estado
// Estado: badge de color según umbrales definidos en financial-metrics skill
// Ordenable por columna
// Exportable a Excel/CSV
```

### Selector de período
```tsx
// src/components/ui/PeriodSelector.tsx
// Props: onPeriodChange, availablePeriods
// Opciones: Mes actual | Trimestre | Semestre | Año | Rango personalizado
// Sincronizado con todos los componentes del dashboard via URL params (no estado global)
// Usar: ?period=2024-12 en la URL para compartir vista
```

## Layout del dashboard principal

```
┌─────────────────────────────────────────────────────┐
│  Header: Logo | Empresa | Período selector | Usuario │
├─────────────────────────────────────────────────────┤
│  Sidebar: Navegación por sección                    │
├──────────────┬──────────────────────────────────────┤
│              │  KPIs (4 tarjetas en fila)           │
│   Sidebar    ├──────────────────────────────────────┤
│              │  Gráfico P&L (barras, 8 meses)       │
│              ├──────────────────────────────────────┤
│              │  Ratios | Flujo de Caja              │
└──────────────┴──────────────────────────────────────┘
```

```tsx
// Grid layout recomendado (Tailwind):
// KPIs: grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4
// Gráficos: grid grid-cols-1 lg:grid-cols-2 gap-6
// Tabla completa: col-span-full
```

## Reglas de UX financiera

**Tipografía de números:**
```tsx
// Usar fuente monoespaciada para columnas de números (alineación decimal)
className="font-mono tabular-nums text-right"

// Tamaños:
// KPI principal: text-3xl font-bold
// Tabla datos: text-sm
// Subtítulos: text-xs text-gray-500
```

**Estados de carga:**
```tsx
// Skeleton mientras carga — nunca spinner giratorio en tablas financieras
// src/components/ui/FinancialSkeleton.tsx
// Skeleton debe tener mismas dimensiones que el contenido real
```

**Mensajes de error:**
```tsx
// Si no hay datos para el período: mostrar estado vacío con instrucción
// "No hay datos para Diciembre 2024. Carga un archivo Excel o conecta Power BI."
// Con botón de acción directo
```

**Responsive:**
- Mobile: solo KPIs y tabla simplificada (sin gráficos complejos)
- Tablet: KPIs + un gráfico
- Desktop: layout completo
- Los informes PDF siempre en formato A4 vertical

## Antipatrones UI a evitar
- No usar colores random para gráficos — siempre usar `FINANCIAL_COLORS.chart`
- No mostrar más de 12 meses en un gráfico de barras sin scroll
- No truncar números con "..." — reducir decimales o abreviar (1.2M)
- No usar tooltips que tapen los datos al hacer hover
- No cambiar colores de semáforo sin actualizar la leyenda
