export type SemaferoEstado = 'green' | 'yellow' | 'red' | 'gray'
export type UnidadRatio = 'porcentaje' | 'veces' | 'dias' | 'moneda'

export interface Umbral {
  bueno: number
  normal: number
  alerta: number
}

export interface Ratio {
  clave: string
  etiqueta: string
  valor: number | null
  unidad: UnidadRatio
  estado: SemaferoEstado
  umbral?: Umbral
}

export interface MetricsResult {
  rentabilidad: Ratio[]
  liquidez: Ratio[]
  endeudamiento: Ratio[]
  eficiencia: Ratio[]
}
