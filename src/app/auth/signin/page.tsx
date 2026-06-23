'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

function SignInContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/'
  const configError = searchParams.get('error') === 'missing_supabase_config'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const supabase = createClient()
    const cleanEmail = email.trim().toLowerCase()

    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })
        if (signInError) throw signInError
        router.push(callbackUrl)
        router.refresh()
        return
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      })
      if (signUpError) throw signUpError
      if (data.session) {
        router.push(callbackUrl)
        router.refresh()
      } else {
        setMessage('Cuenta creada. Revisa tu correo para confirmar el acceso.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar la autenticacion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-10 shadow-xs">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Financial Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">Plataforma NIIF - Ecuador</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-lg bg-gray-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode('signin')
              setError('')
              setMessage('')
            }}
            className={`rounded-md px-3 py-2 font-medium transition ${
              mode === 'signin' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'
            }`}
          >
            Ingresar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup')
              setError('')
              setMessage('')
            }}
            className={`rounded-md px-3 py-2 font-medium transition ${
              mode === 'signup' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'
            }`}
          >
            Registrarse
          </button>
        </div>

        {configError && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Falta configurar Supabase en las variables de entorno.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Nombre completo"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-800 outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-800 outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder="Contrasena"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-800 outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          {message && <p className="text-xs text-emerald-700">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? 'Verificando...' : mode === 'signin' ? 'Ingresar' : 'Crear cuenta'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/auth/forgot-password" className="text-xs font-medium text-blue-600 hover:text-blue-700">
            Olvide mi contrasena
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-gray-400">
          Acceso restringido a contadores y firmas autorizadas
        </p>
      </div>
    </main>
  )
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  )
}
