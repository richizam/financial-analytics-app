'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'

const errorMessages: Record<string, string> = {
  OAuthSignin: 'Error al iniciar sesión con el proveedor.',
  OAuthCallback: 'Error en el callback OAuth. Intenta de nuevo.',
  OAuthCreateAccount: 'No se pudo crear la cuenta.',
  EmailCreateAccount: 'No se pudo crear la cuenta con este email.',
  Callback: 'Error en el proceso de autenticación.',
  AccessDenied: 'No tienes permiso para acceder a esta aplicación.',
  default: 'Ocurrió un error inesperado.',
}

function ErrorContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error') ?? 'default'
  const message = errorMessages[error] ?? errorMessages.default

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-10 text-center shadow-xs">
        <div className="mb-4 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
            </svg>
          </div>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">Error de autenticación</h1>
        <p className="mt-2 text-sm text-gray-500">{message}</p>
        <Link
          href="/auth/signin"
          className="mt-6 inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-700"
        >
          Volver al inicio de sesión
        </Link>
      </div>
    </main>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  )
}
