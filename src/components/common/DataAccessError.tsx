import Link from 'next/link'

interface DataAccessErrorProps {
  title?: string
  message?: string
}

export default function DataAccessError({
  title = 'No pudimos cargar tu workspace',
  message = 'La sesion inicio correctamente, pero el backend no pudo leer los datos asociados a este usuario.',
}: DataAccessErrorProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-xs">
        <p className="text-base font-semibold text-gray-900">{title}</p>
        <p className="mt-2 text-sm leading-6 text-gray-500">{message}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Reintentar
          </Link>
          <Link
            href="/upload"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Subir archivos
          </Link>
        </div>
      </div>
    </main>
  )
}
