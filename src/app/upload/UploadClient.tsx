'use client'

import { useState, useRef } from 'react'
import { suggestCsvMappingAction, uploadCsvAction } from '@/app/actions'
import type { CsvMappingResponse } from '@/app/actions'
import { Upload, CheckCircle, XCircle, Loader2, ArrowLeft, Sparkles } from 'lucide-react'
import Link from 'next/link'

interface UploadResult { filename: string; ok: boolean; error?: string }

export default function UploadClient() {
  const [ruc, setRuc]           = useState('')
  const [files, setFiles]       = useState<FileList | null>(null)
  const [results, setResults]   = useState<UploadResult[]>([])
  const [mapping, setMapping]   = useState<CsvMappingResponse | null>(null)
  const [mappingError, setMappingError] = useState<string | null>(null)
  const [mappingLoading, setMappingLoading] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!files || files.length === 0) return
    setLoading(true)
    setResults([])

    const newResults: UploadResult[] = []
    for (const file of Array.from(files)) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('ruc', ruc)
        const res = await uploadCsvAction(fd)
        newResults.push({ filename: file.name, ok: res.ok, error: res.error })
      } catch (err) {
        newResults.push({ filename: file.name, ok: false, error: String(err) })
      }
      // Mostrar progreso en tiempo real
      setResults([...newResults])
    }
    setLoading(false)
    if (newResults.every(r => r.ok)) {
      setFiles(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleSuggestMapping() {
    const file = files?.[0]
    if (!file) return
    setMappingLoading(true)
    setMapping(null)
    setMappingError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      setMapping(await suggestCsvMappingAction(fd))
    } catch (err) {
      setMappingError(err instanceof Error ? err.message : String(err))
    } finally {
      setMappingLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    setFiles(e.dataTransfer.files)
    setMapping(null)
  }

  const completed = results.length
  const total = files?.length ?? 0

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} /> Volver al dashboard
        </Link>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-xs">
          <h1 className="mb-1 text-lg font-semibold text-gray-900">Cargar archivos CSV</h1>
          <p className="mb-6 text-sm text-gray-500">
            Sube los archivos de asientos por período (<code>YYYYMM.csv</code>) y
            opcionalmente los saldos iniciales (<code>saldos_iniciales_YYYY.csv</code>).
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">RUC de la empresa</label>
              <input
                type="text"
                value={ruc}
                onChange={e => setRuc(e.target.value.replace(/\D/g, '').slice(0, 13))}
                placeholder="1234567890001"
                maxLength={13}
                required
                pattern="\d{13}"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              <Upload className="mx-auto mb-2 text-gray-400" size={28} />
              {files && files.length > 0 ? (
                <p className="text-sm font-medium text-gray-700">
                  {files.length} archivo{files.length > 1 ? 's' : ''} seleccionado{files.length > 1 ? 's' : ''}
                </p>
              ) : (
                <>
                  <p className="text-sm text-gray-600">Arrastra los archivos CSV aquí</p>
                  <p className="mt-1 text-xs text-gray-400">o haz clic para seleccionarlos</p>
                </>
              )}
              <input ref={inputRef} type="file" accept=".csv" multiple className="hidden"
                onChange={e => { setFiles(e.target.files); setMapping(null) }} />
            </div>

            <button
              type="button"
              onClick={handleSuggestMapping}
              disabled={mappingLoading || !files || files.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mappingLoading
                ? <><Loader2 size={16} className="animate-spin" /> Analizando formato...</>
                : <><Sparkles size={16} /> Sugerir mapeo con AI</>}
            </button>

            {mapping && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-950">Mapeo sugerido</p>
                    <p className="text-xs text-blue-700">
                      {mapping.provider === 'xai' ? 'AI reviso' : 'Heuristica reviso'} columnas y ejemplos enmascarados.
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-medium text-blue-700">
                    {Math.round(mapping.proposal.confidence * 100)}%
                  </span>
                </div>

                <div className="grid gap-1 text-xs sm:grid-cols-2">
                  {Object.entries(mapping.proposal.mapping)
                    .filter(([, source]) => source)
                    .map(([target, source]) => (
                      <div key={target} className="flex items-center justify-between gap-2 rounded-sm bg-white px-2 py-1.5">
                        <span className="font-medium text-gray-600">{target}</span>
                        <span className="truncate text-gray-900">{source}</span>
                      </div>
                    ))}
                </div>

                {mapping.warnings.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {mapping.warnings.slice(0, 4).map((warning, index) => (
                      <p key={index} className="text-xs text-blue-800">{warning}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mappingError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {mappingError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !files || files.length === 0 || ruc.length !== 13}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Subiendo {completed}/{total}...</>
                : <><Upload size={16} /> Subir archivos</>}
            </button>
          </form>

          {results.length > 0 && (
            <div className="mt-6 space-y-2">
              <p className="text-sm font-medium text-gray-700">
                Resultado ({results.filter(r => r.ok).length}/{results.length} exitosos):
              </p>
              {results.map((r, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                  r.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                }`}>
                  {r.ok
                    ? <CheckCircle size={16} className="mt-0.5 shrink-0" />
                    : <XCircle size={16} className="mt-0.5 shrink-0" />}
                  <div>
                    <span className="font-medium">{r.filename}</span>
                    {r.error && <p className="mt-0.5 text-xs opacity-80">{r.error}</p>}
                  </div>
                </div>
              ))}
              {!loading && results.every(r => r.ok) && (
                <Link href="/" className="mt-2 block text-center text-sm text-blue-600 hover:underline">
                  Ver en el dashboard →
                </Link>
              )}
            </div>
          )}

          <details className="mt-6">
            <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">
              Ver formato esperado del CSV
            </summary>
            <div className="mt-2 overflow-x-auto rounded-sm border border-gray-100 bg-gray-50 p-3">
              <code className="block whitespace-pre text-xs text-gray-700">
{`fecha,asiento,tipo,codCuenta,nombreCuenta,descripcion,debe,haber,centroCosto
2025-01-05,AJ-202501-001,VT,4.1.1.01,Ventas,Factura 001,0.00,1500.00,VENTAS
2025-01-05,AJ-202501-001,VT,1.1.3.01,Cuentas x cobrar,Factura 001,1500.00,0.00,VENTAS`}
              </code>
            </div>
          </details>
        </div>
      </div>
    </main>
  )
}
