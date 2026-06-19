'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, ChevronLeft, ChevronRight, ArrowLeft, Loader2 } from 'lucide-react'
import { saveCompanyConfig } from '@/app/actions'
import type { CompanyConfig } from '@/app/actions'

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoContribuyente = 'sociedad' | 'persona_natural_obligada' | 'persona_natural_no_obligada'
type Clasificacion     = 'grande' | 'mediana' | 'pequena' | 'microempresa'
type NiifFramework     = 'niif_completas' | 'niif_pymes' | 'rimpe'
type Regimen           = 'general' | 'rimpe_microempresa' | 'rimpe_negocio_popular'
type Sector            = 'comercial' | 'servicios' | 'industrial' | 'construccion' | 'agricola' | 'salud' | 'educacion' | 'tecnologia' | 'transporte' | 'otro'
type FuenteDatos       = 'excel' | 'powerbi' | 'ambos'
type MetodoInv         = 'promedio_ponderado' | 'fifo'

interface Form {
  razonSocial: string; nombreComercial: string; ruc: string; tipoContribuyente: TipoContribuyente | ''
  activosTotales: string; ingresos: string; empleados: string; cotizaEnBolsa: boolean; esEntidadFinanciera: boolean
  regimenTributario: Regimen | ''; agenteRetencion: boolean; contribuyenteEspecial: boolean
  sector: Sector | ''
  tieneInventarios: boolean; tieneActivosFijos: boolean; tieneArrendamientos: boolean
  metodoInventarios: MetodoInv | ''; mesInicioEjercicio: number
  fuenteDatos: FuenteDatos | ''
}

const EMPTY: Form = {
  razonSocial: '', nombreComercial: '', ruc: '', tipoContribuyente: '',
  activosTotales: '', ingresos: '', empleados: '', cotizaEnBolsa: false, esEntidadFinanciera: false,
  regimenTributario: '', agenteRetencion: false, contribuyenteEspecial: false,
  sector: '',
  tieneInventarios: false, tieneActivosFijos: true, tieneArrendamientos: false,
  metodoInventarios: '', mesInicioEjercicio: 1,
  fuenteDatos: '',
}

// ─── RUC validation (Ecuador) ─────────────────────────────────────────────────

function chkPersonaNatural(d: number[]): boolean {
  const w = [2, 1, 2, 1, 2, 1, 2, 1, 2]
  let s = 0
  for (let i = 0; i < 9; i++) { let v = d[i] * w[i]; if (v >= 10) v -= 9; s += v }
  const c = s % 10 === 0 ? 0 : 10 - (s % 10)
  return c === d[9]
}

function chkSociedad(d: number[]): boolean {
  const w = [4, 3, 2, 7, 6, 5, 4, 3, 2]
  let s = 0
  for (let i = 0; i < 9; i++) s += d[i] * w[i]
  const mod = s % 11
  const c = mod === 0 ? 0 : 11 - mod
  return c < 10 && c === d[9]
}

function chkPublico(d: number[]): boolean {
  const w = [3, 2, 7, 6, 5, 4, 3, 2]
  let s = 0
  for (let i = 0; i < 8; i++) s += d[i] * w[i]
  const mod = s % 11
  const c = mod === 0 ? 0 : 11 - mod
  return c < 10 && c === d[8]
}

function validarRUC(ruc: string): string | null {
  if (!/^\d{13}$/.test(ruc)) return 'Debe tener exactamente 13 dígitos numéricos'
  const prov = parseInt(ruc.substring(0, 2))
  if (prov < 1 || prov > 24) return 'Código de provincia inválido (primeros 2 dígitos: 01–24)'
  const d = ruc.split('').map(Number)
  const t = d[2]
  if (t === 6) { if (!chkPublico(d)) return 'Dígito verificador inválido' }
  else if (t === 9) { if (!chkSociedad(d)) return 'Dígito verificador inválido' }
  else if (t <= 5)  { if (!chkPersonaNatural(d)) return 'Dígito verificador inválido' }
  else return 'Tercer dígito inválido (debe ser 0–6 ó 9)'
  return null
}

// ─── Classification / NIIF helpers ───────────────────────────────────────────

function clasificar(activos: number, ing: number, emp: number): Clasificacion {
  if ([activos > 5_000_000, ing > 5_000_000, emp > 200].filter(Boolean).length >= 2) return 'grande'
  if ([activos > 1_000_000, ing > 1_000_000, emp > 50].filter(Boolean).length >= 2)  return 'mediana'
  if ([activos > 100_000,   ing > 100_000,   emp > 10].filter(Boolean).length >= 2)  return 'pequena'
  return 'microempresa'
}

function niifPara(cl: Clasificacion, bolsa: boolean, fin: boolean): NiifFramework {
  if (bolsa || fin || cl === 'grande') return 'niif_completas'
  if (cl === 'mediana' || cl === 'pequena') return 'niif_pymes'
  return 'rimpe'
}

const CLASIFICACION_LABEL: Record<Clasificacion, string> = {
  grande: 'Grande', mediana: 'Mediana', pequena: 'Pequeña', microempresa: 'Microempresa',
}

const NIIF_LABEL: Record<NiifFramework, { title: string; desc: string; color: string }> = {
  niif_completas: { title: 'NIIF Completas',    desc: 'Normas internacionales completas (NIC/NIIF) — obligatorio para grandes y cotizadas', color: 'blue' },
  niif_pymes:     { title: 'NIIF para PYMES',   desc: 'Normas simplificadas para medianas y pequeñas sin obligación pública de rendir cuentas', color: 'green' },
  rimpe:          { title: 'RIMPE',              desc: 'Régimen simplificado para microempresas — contabilidad básica', color: 'amber' },
}

const SECTOR_LABEL: Record<string, string> = {
  comercial: 'Comercial', servicios: 'Servicios', industrial: 'Industrial',
  construccion: 'Construcción', agricola: 'Agrícola', salud: 'Salud',
  educacion: 'Educación', tecnologia: 'Tecnología', transporte: 'Transporte', otro: 'Otro',
}

const SECTOR_RATIOS: Record<string, string[]> = {
  comercial:    ['Margen bruto / neto', 'Razón corriente', 'Rotación de inventarios', 'Días de cobro y pago', 'Ciclo de conversión de efectivo'],
  servicios:    ['Margen bruto / neto', 'Razón corriente', 'ROE / ROA', 'Días de cobro'],
  industrial:   ['Margen bruto / neto / EBITDA', 'Rotación de inventarios', 'Cobertura de intereses', 'Apalancamiento'],
  construccion: ['Margen bruto / neto', 'Razón corriente', 'Apalancamiento', 'Días de cobro'],
  agricola:     ['Margen bruto', 'Rotación de inventarios', 'Capital de trabajo', 'Razón corriente'],
  salud:        ['Margen bruto / neto', 'Razón corriente', 'Días de cobro', 'ROA'],
  educacion:    ['Margen neto', 'Razón corriente', 'Capital de trabajo'],
  tecnologia:   ['Margen bruto / neto', 'EBITDA', 'ROE / ROA', 'Días de cobro'],
  transporte:   ['Margen neto', 'EBITDA', 'Apalancamiento', 'Cobertura de intereses'],
  otro:         ['Margen bruto / neto', 'Razón corriente', 'ROE / ROA'],
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-sm font-medium text-gray-700">{children}</p>
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="mt-1 text-xs text-red-600">{msg}</p>
}

function Input({
  value, onChange, placeholder, type = 'text', error,
}: {
  value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; error?: string
}) {
  return (
    <>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-colors ${
          error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
      />
      <FieldError msg={error} />
    </>
  )
}

function Select({
  value, onChange, options, placeholder, error,
}: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string; error?: string
}) {
  return (
    <>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-colors ${
          error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <FieldError msg={error} />
    </>
  )
}

function Toggle({
  checked, onChange, label, sublabel,
}: {
  checked: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {sublabel && <span className="block text-xs text-gray-400">{sublabel}</span>}
      </span>
    </label>
  )
}

function RadioGroup<T extends string>({
  value, onChange, options,
}: {
  value: T | ''; onChange: (v: T) => void
  options: { value: T; label: string; desc?: string }[]
}) {
  return (
    <div className="space-y-2">
      {options.map(o => (
        <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
          value === o.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
        }`}>
          <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
            value === o.value ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
          }`}>
            {value === o.value && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </div>
          <input type="radio" className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
          <div>
            <p className="text-sm font-medium text-gray-900">{o.label}</p>
            {o.desc && <p className="text-xs text-gray-500 mt-0.5">{o.desc}</p>}
          </div>
        </label>
      ))}
    </div>
  )
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function Step1({ form, update, errors }: { form: Form; update: (p: Partial<Form>) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <div>
        <Label>Razón social *</Label>
        <Input value={form.razonSocial} onChange={v => update({ razonSocial: v })} placeholder="Distribuidora XYZ S.A." error={errors.razonSocial} />
      </div>
      <div>
        <Label>Nombre comercial <span className="text-gray-400 font-normal">(opcional)</span></Label>
        <Input value={form.nombreComercial} onChange={v => update({ nombreComercial: v })} placeholder="XYZ Distribuidora" />
      </div>
      <div>
        <Label>RUC *</Label>
        <Input value={form.ruc} onChange={v => update({ ruc: v.replace(/\D/g, '').slice(0, 13) })} placeholder="0990123456001" error={errors.ruc} />
        {form.ruc.length === 13 && !errors.ruc && (
          <p className="mt-1 text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> RUC válido</p>
        )}
      </div>
      <div>
        <Label>Tipo de contribuyente *</Label>
        <RadioGroup
          value={form.tipoContribuyente}
          onChange={v => update({ tipoContribuyente: v })}
          options={[
            { value: 'sociedad',                     label: 'Sociedad', desc: 'S.A., Cía. Ltda., Fundación, Cooperativa, etc.' },
            { value: 'persona_natural_obligada',      label: 'Persona natural obligada a llevar contabilidad', desc: 'Ingresos > $300K o activos > $180K' },
            { value: 'persona_natural_no_obligada',   label: 'Persona natural no obligada', desc: 'Régimen simplificado' },
          ]}
        />
        <FieldError msg={errors.tipoContribuyente} />
      </div>
    </div>
  )
}

function Step2({ form, update, errors }: { form: Form; update: (p: Partial<Form>) => void; errors: Record<string, string> }) {
  const activos = parseFloat(form.activosTotales) || 0
  const ing     = parseFloat(form.ingresos) || 0
  const emp     = parseInt(form.empleados) || 0
  const hasDatos = activos > 0 || ing > 0 || emp > 0

  const cl   = hasDatos ? clasificar(activos, ing, emp) : null
  const niif = cl ? niifPara(cl, form.cotizaEnBolsa, form.esEntidadFinanciera) : null

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
        Se necesitan <strong>2 de 3</strong> criterios para clasificar el tamaño. Usa cifras del último ejercicio fiscal.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label>Activos totales (USD)</Label>
          <Input value={form.activosTotales} onChange={v => update({ activosTotales: v })} placeholder="1,500,000" type="number" error={errors.activosTotales} />
        </div>
        <div>
          <Label>Ingresos brutos (USD)</Label>
          <Input value={form.ingresos} onChange={v => update({ ingresos: v })} placeholder="2,000,000" type="number" error={errors.ingresos} />
        </div>
        <div>
          <Label>N° empleados</Label>
          <Input value={form.empleados} onChange={v => update({ empleados: v })} placeholder="45" type="number" error={errors.empleados} />
        </div>
      </div>

      {cl && niif && (
        <div className={`rounded-xl border-2 p-4 ${
          niif === 'niif_completas' ? 'border-blue-400 bg-blue-50'
          : niif === 'niif_pymes'  ? 'border-green-400 bg-green-50'
          : 'border-amber-400 bg-amber-50'
        }`}>
          <div className="flex items-start gap-3">
            <Check className={`h-5 w-5 mt-0.5 ${niif === 'niif_completas' ? 'text-blue-600' : niif === 'niif_pymes' ? 'text-green-600' : 'text-amber-600'}`} />
            <div>
              <p className="font-semibold text-gray-900 text-sm">
                Empresa {CLASIFICACION_LABEL[cl]} — aplica <span className="font-bold">{NIIF_LABEL[niif].title}</span>
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{NIIF_LABEL[niif].desc}</p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2 pt-1">
        <p className="text-sm font-medium text-gray-700">Obligación pública de rendir cuentas</p>
        <Toggle checked={form.cotizaEnBolsa} onChange={v => update({ cotizaEnBolsa: v })}
          label="Cotiza en bolsa de valores" sublabel="Obliga a NIIF Completas independientemente del tamaño" />
        <Toggle checked={form.esEntidadFinanciera} onChange={v => update({ esEntidadFinanciera: v })}
          label="Es entidad financiera" sublabel="Bancos, cooperativas de ahorro y crédito, casas de cambio" />
      </div>
    </div>
  )
}

function Step3({ form, update, errors }: { form: Form; update: (p: Partial<Form>) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <div>
        <Label>Régimen tributario (SRI) *</Label>
        <RadioGroup
          value={form.regimenTributario}
          onChange={v => update({ regimenTributario: v })}
          options={[
            { value: 'general',               label: 'Régimen General', desc: 'La mayoría de sociedades y personas naturales obligadas' },
            { value: 'rimpe_microempresa',     label: 'RIMPE — Microempresa', desc: 'Ingresos brutos anuales entre $20K y $300K' },
            { value: 'rimpe_negocio_popular',  label: 'RIMPE — Negocio Popular', desc: 'Ingresos brutos anuales hasta $20K' },
          ]}
        />
        <FieldError msg={errors.regimenTributario} />
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-sm font-medium text-gray-700">Calificaciones especiales</p>
        <Toggle checked={form.agenteRetencion} onChange={v => update({ agenteRetencion: v })}
          label="Agente de retención del IVA / IR" sublabel="Habilitado por resolución del SRI para retener impuestos a terceros" />
        <Toggle checked={form.contribuyenteEspecial} onChange={v => update({ contribuyenteEspecial: v })}
          label="Contribuyente especial" sublabel="Designado por el SRI — tiene obligaciones diferenciadas" />
      </div>
    </div>
  )
}

function Step4({ form, update, errors }: { form: Form; update: (p: Partial<Form>) => void; errors: Record<string, string> }) {
  const sectores = Object.entries(SECTOR_LABEL) as [Sector, string][]
  const ratios = form.sector ? SECTOR_RATIOS[form.sector] : null

  return (
    <div className="space-y-5">
      <div>
        <Label>Sector económico *</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {sectores.map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => update({ sector: val })}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium text-left transition-colors ${
                form.sector === val
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <FieldError msg={errors.sector} />
      </div>

      {ratios && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Ratios que se activarán — sector {SECTOR_LABEL[form.sector]}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ratios.map(r => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2.5 py-1 text-xs text-gray-700">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Step5({ form, update }: { form: Form; update: (p: Partial<Form>) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Módulos contables activos</p>
        <Toggle checked={form.tieneInventarios} onChange={v => update({ tieneInventarios: v, metodoInventarios: v ? form.metodoInventarios : '' })}
          label="Tiene inventarios de mercadería / producción"
          sublabel="Activa ratios de rotación de inventarios, días de inventario, CCE" />
        <Toggle checked={form.tieneActivosFijos} onChange={v => update({ tieneActivosFijos: v })}
          label="Tiene activos fijos (propiedades, planta y equipo)"
          sublabel="Activa módulo de depreciación NIC 16" />
        <Toggle checked={form.tieneArrendamientos} onChange={v => update({ tieneArrendamientos: v })}
          label="Tiene contratos de arrendamiento NIIF 16"
          sublabel="Arriendos operativos capitalizados — afecta EBITDA y balance" />
      </div>

      {form.tieneInventarios && (
        <div>
          <Label>Método de valoración de inventarios</Label>
          <RadioGroup
            value={form.metodoInventarios}
            onChange={v => update({ metodoInventarios: v })}
            options={[
              { value: 'promedio_ponderado', label: 'Costo promedio ponderado', desc: 'Método más común en Ecuador — fácil de aplicar' },
              { value: 'fifo',               label: 'FIFO (Primero en entrar, primero en salir)', desc: 'Precio de los productos más antiguos al costo de venta' },
            ]}
          />
        </div>
      )}

      <div>
        <Label>Mes de inicio del ejercicio fiscal</Label>
        <select
          value={form.mesInicioEjercicio}
          onChange={e => update({ mesInicioEjercicio: parseInt(e.target.value) })}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
        >
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        {form.mesInicioEjercicio !== 1 && (
          <p className="mt-1 text-xs text-amber-600">La mayoría de empresas en Ecuador inician en enero. Verifica con tu contador.</p>
        )}
      </div>
    </div>
  )
}

function Step6({ form, update, errors }: { form: Form; update: (p: Partial<Form>) => void; errors: Record<string, string> }) {
  return (
    <div className="space-y-5">
      <div>
        <Label>Fuente principal de datos *</Label>
        <RadioGroup
          value={form.fuenteDatos}
          onChange={v => update({ fuenteDatos: v })}
          options={[
            { value: 'excel',   label: 'Archivos Excel / CSV', desc: 'Exportación del sistema contable en formato YYYYMM.csv' },
            { value: 'powerbi', label: 'Power BI',             desc: 'Conexión directa via Power BI REST API (requiere configuración adicional)' },
            { value: 'ambos',   label: 'Ambos',                desc: 'Excel como respaldo histórico + Power BI para datos en tiempo real' },
          ]}
        />
        <FieldError msg={errors.fuenteDatos} />
      </div>

      {(form.fuenteDatos === 'excel' || form.fuenteDatos === 'ambos') && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Estructura de archivos esperada</p>
          <div className="font-mono text-xs text-gray-700 space-y-1 leading-relaxed">
            <p className="text-gray-400">data/empresas/<span className="text-blue-600">{form.ruc || 'RUC'}</span>/</p>
            <p className="pl-4">├── <span className="text-green-700">202501.csv</span>  <span className="text-gray-400">← diario de enero 2025</span></p>
            <p className="pl-4">├── <span className="text-green-700">202502.csv</span>  <span className="text-gray-400">← diario de febrero 2025</span></p>
            <p className="pl-4">├── <span className="text-green-700">...</span></p>
            <p className="pl-4">├── <span className="text-amber-700">saldos_iniciales_2025.csv</span>  <span className="text-gray-400">← apertura del año</span></p>
            <p className="pl-4">└── <span className="text-blue-600">config.json</span>  <span className="text-gray-400">← esta configuración</span></p>
          </div>
          <p className="text-xs text-gray-500 pt-1">
            Columnas del diario: <code className="bg-gray-200 rounded-sm px-1">fecha, asiento, tipo, codCuenta, nombreCuenta, descripcion, debe, haber</code>
          </p>
        </div>
      )}

      {(form.fuenteDatos === 'powerbi' || form.fuenteDatos === 'ambos') && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-2">Variables de entorno requeridas</p>
          <div className="font-mono text-xs text-gray-700 space-y-0.5">
            <p>POWERBI_TENANT_ID=<span className="text-gray-400">tu-tenant-id</span></p>
            <p>POWERBI_CLIENT_ID=<span className="text-gray-400">tu-app-id</span></p>
            <p>POWERBI_CLIENT_SECRET=<span className="text-gray-400">tu-secreto</span></p>
            <p>POWERBI_WORKSPACE_ID=<span className="text-gray-400">tu-workspace</span></p>
          </div>
          <p className="text-xs text-amber-700 mt-2">Agregar estas variables en <code>.env.local</code> antes de usar la conexión.</p>
        </div>
      )}
    </div>
  )
}

// ─── Progress stepper ─────────────────────────────────────────────────────────

const STEP_LABELS = ['Identidad', 'Tamaño', 'Tributario', 'Sector', 'Contable', 'Datos']

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center mb-8 select-none">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                done   ? 'bg-blue-600 text-white'
                : active ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500'
                : 'bg-gray-100 text-gray-400'
              }`}>
                {done ? <Check className="h-3.5 w-3.5" /> : n}
              </div>
              <span className={`text-xs hidden sm:block ${active ? 'text-blue-700 font-semibold' : done ? 'text-gray-500' : 'text-gray-400'}`}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1.5 mb-4 ${done ? 'bg-blue-500' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(step: number, form: Form): Record<string, string> {
  const e: Record<string, string> = {}

  if (step === 1) {
    if (!form.razonSocial.trim()) e.razonSocial = 'La razón social es obligatoria'
    const rucErr = validarRUC(form.ruc)
    if (rucErr) e.ruc = rucErr
    if (!form.tipoContribuyente) e.tipoContribuyente = 'Selecciona el tipo de contribuyente'
  }

  if (step === 2) {
    if (!form.activosTotales || parseFloat(form.activosTotales) < 0) e.activosTotales = 'Ingresa los activos totales'
    if (!form.ingresos       || parseFloat(form.ingresos)       < 0) e.ingresos       = 'Ingresa los ingresos brutos'
    if (!form.empleados      || parseInt(form.empleados)         < 0) e.empleados      = 'Ingresa el número de empleados'
  }

  if (step === 3) {
    if (!form.regimenTributario) e.regimenTributario = 'Selecciona el régimen tributario'
  }

  if (step === 4) {
    if (!form.sector) e.sector = 'Selecciona el sector económico'
  }

  if (step === 6) {
    if (!form.fuenteDatos) e.fuenteDatos = 'Selecciona la fuente de datos'
  }

  return e
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ form }: { form: Form }) {
  const activos = parseFloat(form.activosTotales) || 0
  const ing     = parseFloat(form.ingresos) || 0
  const emp     = parseInt(form.empleados) || 0
  const cl      = clasificar(activos, ing, emp)
  const niif    = niifPara(cl, form.cotizaEnBolsa, form.esEntidadFinanciera)

  const rows = [
    { label: 'Empresa',        value: form.razonSocial + (form.nombreComercial ? ` (${form.nombreComercial})` : '') },
    { label: 'RUC',            value: form.ruc },
    { label: 'Clasificación',  value: `${CLASIFICACION_LABEL[cl]} — ${NIIF_LABEL[niif].title}` },
    { label: 'Régimen SRI',    value: form.regimenTributario.replace(/_/g, ' ') },
    { label: 'Sector',         value: SECTOR_LABEL[form.sector] ?? '' },
    { label: 'Inventarios',    value: form.tieneInventarios ? `Sí — ${(form.metodoInventarios || '').replace(/_/g, ' ')}` : 'No' },
    { label: 'Fuente datos',   value: form.fuenteDatos },
  ]

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 divide-y divide-gray-200 mb-5">
      {rows.map(r => (
        <div key={r.label} className="flex items-start gap-4 px-4 py-2.5">
          <span className="w-28 shrink-0 text-xs text-gray-500 pt-0.5">{r.label}</span>
          <span className="text-sm font-medium text-gray-900 capitalize">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const STEP_TITLES = [
  { title: 'Identidad legal',              sub: 'Datos básicos de la empresa' },
  { title: 'Tamaño y clasificación NIIF',  sub: 'Determina el marco normativo aplicable' },
  { title: 'Régimen tributario (SRI)',      sub: 'Calificaciones ante el Servicio de Rentas Internas' },
  { title: 'Sector económico',             sub: 'Define los ratios y benchmarks del sector' },
  { title: 'Configuración contable',       sub: 'Módulos y políticas contables activos' },
  { title: 'Fuente de datos',              sub: 'Cómo se cargarán los datos financieros' },
]

export default function SetupWizard() {
  const router = useRouter()
  const [step, setStep]       = useState(1)
  const [form, setForm]       = useState<Form>(EMPTY)
  const [errors, setErrors]   = useState<Record<string, string>>({})
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function update(partial: Partial<Form>) {
    setForm(prev => ({ ...prev, ...partial }))
    // Clear errors for changed fields
    const changed = Object.keys(partial)
    setErrors(prev => {
      const next = { ...prev }
      changed.forEach(k => delete next[k])
      return next
    })
  }

  function goNext() {
    const errs = validate(step, form)
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setErrors({})
    setStep(s => Math.min(6, s + 1))
  }

  function goBack() {
    setErrors({})
    setStep(s => Math.max(1, s - 1))
  }

  async function handleSubmit() {
    const errs = validate(6, form)
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    setSaving(true)
    setSaveError(null)

    const activos = parseFloat(form.activosTotales) || 0
    const ing     = parseFloat(form.ingresos) || 0
    const emp     = parseInt(form.empleados) || 0
    const cl      = clasificar(activos, ing, emp)
    const niif    = niifPara(cl, form.cotizaEnBolsa, form.esEntidadFinanciera)

    const config: CompanyConfig = {
      razonSocial:          form.razonSocial.trim(),
      ...(form.nombreComercial.trim() && { nombreComercial: form.nombreComercial.trim() }),
      ruc:                  form.ruc,
      tipoContribuyente:    form.tipoContribuyente,
      clasificacion:        cl,
      niifFramework:        niif,
      cotizaEnBolsa:        form.cotizaEnBolsa,
      esEntidadFinanciera:  form.esEntidadFinanciera,
      regimenTributario:    form.regimenTributario,
      agenteRetencion:      form.agenteRetencion,
      contribuyenteEspecial: form.contribuyenteEspecial,
      sector:               form.sector,
      tieneInventarios:     form.tieneInventarios,
      tieneActivosFijos:    form.tieneActivosFijos,
      tieneArrendamientos:  form.tieneArrendamientos,
      ...(form.tieneInventarios && form.metodoInventarios && { metodoInventarios: form.metodoInventarios }),
      mesInicioEjercicio:   form.mesInicioEjercicio,
      fuenteDatos:          form.fuenteDatos,
      createdAt:            new Date().toISOString(),
    }

    const result = await saveCompanyConfig(config)
    setSaving(false)

    if (!result.ok) {
      setSaveError(result.error ?? 'Error desconocido al guardar')
      return
    }

    // Signal dashboard to select this RUC after redirect
    sessionStorage.setItem('setup_ruc', form.ruc)
    router.push('/')
  }

  const { title, sub } = STEP_TITLES[step - 1]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white shadow-xs">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center gap-3">
          <Link href="/" className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors">
            FA
          </Link>
          <div>
            <h1 className="text-sm font-bold text-gray-900">Nueva empresa</h1>
            <p className="text-xs text-gray-500">Paso {step} de 6</p>
          </div>
          <Link href="/" className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver
          </Link>
        </div>
      </header>

      {/* Progress bar */}
      <div className="h-1 bg-gray-200">
        <div
          className="h-1 bg-blue-600 transition-all duration-300"
          style={{ width: `${(step / 6) * 100}%` }}
        />
      </div>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <Stepper current={step} />

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs">
          {/* Step header */}
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{sub}</p>
          </div>

          {/* Step content */}
          {step === 1 && <Step1 form={form} update={update} errors={errors} />}
          {step === 2 && <Step2 form={form} update={update} errors={errors} />}
          {step === 3 && <Step3 form={form} update={update} errors={errors} />}
          {step === 4 && <Step4 form={form} update={update} errors={errors} />}
          {step === 5 && <Step5 form={form} update={update} />}
          {step === 6 && (
            <>
              <SummaryCard form={form} />
              <Step6 form={form} update={update} errors={errors} />
            </>
          )}

          {saveError && (
            <p className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{saveError}</p>
          )}

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-5">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>

            {step < 6 ? (
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-xs"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-xs"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {saving ? 'Guardando…' : 'Crear empresa'}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
