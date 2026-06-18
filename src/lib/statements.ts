export interface StatementItem {
  codCuenta: string
  nombreCuenta: string
  monto: number
  saldo: number
}

export interface StatementSection {
  titulo: string
  items: StatementItem[]
  total: number
}

export interface ESF {
  activosCorrientes: StatementSection
  activosNoCorrientes: StatementSection
  totalActivos: number
  pasivosCorrientes: StatementSection
  pasivosNoCorrientes: StatementSection
  totalPasivos: number
  patrimonio: StatementSection
  totalPatrimonio: number
  totalPasivosMasPatrimonio: number
  diferencia: number
}

export interface ERI {
  ingresos: StatementSection
  costoVentas: StatementSection
  utilidadBruta: number
  margenBruto: number
  gastosOperacion: StatementSection
  utilidadOperacional: number
  ebitda: number
  margenEbitda: number
  otrosGastos: StatementSection
  utilidadAntesParticipacion: number
  participacionTrabajadores: number
  utilidadAntesIR: number
  impuestoRenta: number
  utilidadNeta: number
  margenNeto: number
  ptEnAsientos: boolean
  irEnAsientos: boolean
}
