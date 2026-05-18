---
name: user-auth
description: Gestión de usuarios, roles, autenticación y autorización. Activar cuando se trabaje con login, registro, roles (admin/contador/auditor/gerente), protección de rutas, sesiones o permisos de acceso.
---

# User Auth Skill

## Cuándo se activa
- Implementar o modificar autenticación
- Crear protección de rutas por rol
- Agregar o cambiar permisos de acceso
- Construir el módulo de administración de usuarios
- Trabajar con sesiones o tokens JWT


## Modelo multi-empresa

Un usuario puede pertenecer a múltiples empresas con roles distintos en cada una.

```prisma
// Tabla pivote usuario ↔ empresa
model UserCompany {
  id        String   @id @default(cuid())
  userId    String
  companyId String
  role      UserRole
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id])
  company Company @relation(fields: [companyId], references: [id])

  @@unique([userId, companyId])  // un rol por empresa
}
```

**Empresa activa en sesión:**
```typescript
// El JWT incluye la empresa activa:
// { userId, role, companyId, companyName }
// El usuario puede cambiar de empresa sin cerrar sesión

// Selector de empresa en header — mostrar solo si tiene más de 1
// Al cambiar empresa: actualizar JWT y redirigir a /dashboard
```

**Permisos efectivos = rol en la empresa activa:**
```typescript
// NUNCA usar el rol global para autorizar — siempre el rol en la empresa
const { companyId, role } = session.user
// verificar que userId tiene ese role en companyId antes de cualquier operación
```

## Stack de autenticación
- **NextAuth.js v5** (Auth.js) con adapter de Prisma
- **Proveedor:** Credentials (email + password) como mínimo
- **Opcional:** Google OAuth para empresas con Google Workspace
- **Sesión:** JWT (stateless) — no server-side sessions
- **Passwords:** bcrypt con salt rounds = 12

## Roles y permisos

```typescript
// src/types/auth.ts
export type UserRole = 'admin' | 'contador' | 'auditor' | 'gerente'

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'users:read', 'users:write', 'users:delete',
    'data:read', 'data:write', 'data:delete',
    'reports:read', 'reports:export',
    'anomalies:read',
    'settings:write',
  ],
  contador: [
    'data:read', 'data:write',
    'reports:read', 'reports:export',
    'anomalies:read',
  ],
  auditor: [
    'data:read',
    'reports:read', 'reports:export',
    'anomalies:read',
  ],
  gerente: [
    'data:read',
    'reports:read',          // solo resumen ejecutivo
  ],
}
```

## Esquema Prisma

```prisma
// prisma/schema.prisma

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String
  passwordHash  String
  role          UserRole  @default(auditor)
  active        Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  lastLoginAt   DateTime?
  
  // Empresa a la que pertenece (multi-tenant futuro)
  companyId     String?
  company       Company?  @relation(fields: [companyId], references: [id])
  
  sessions      Session[]
  auditLogs     AuditLog[]
}

enum UserRole {
  admin
  contador
  auditor
  gerente
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  action    String   // "report:export", "data:upload", "user:create"
  resource  String?  // ID del recurso afectado
  details   Json?    // metadata adicional
  ip        String?
  createdAt DateTime @default(now())
}
```

## Configuración NextAuth

```typescript
// src/auth.ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsed = LoginSchema.safeParse(credentials)
        if (!parsed.success) return null

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email, active: true },
        })
        if (!user) return null

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
        if (!valid) return null

        // Log del login exitoso
        await prisma.auditLog.create({
          data: { userId: user.id, action: 'auth:login' },
        })

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = user.role
      return token
    },
    session({ session, token }) {
      session.user.role = token.role as UserRole
      return session
    },
  },
})
```

## Protección de rutas

```typescript
// src/middleware.ts
import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const role = req.auth?.user?.role

  // Rutas públicas
  if (pathname.startsWith('/login')) return NextResponse.next()

  // Sin sesión → login
  if (!req.auth) return NextResponse.redirect(new URL('/login', req.url))

  // Rutas de admin solo para admin
  if (pathname.startsWith('/admin') && role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon).*)'],
}
```

```typescript
// Helper para verificar permisos en Server Components y API Routes
// src/lib/auth-helpers.ts
import { auth } from '@/auth'
import { ROLE_PERMISSIONS } from '@/types/auth'

export async function requirePermission(permission: string) {
  const session = await auth()
  if (!session?.user?.role) throw new Error('UNAUTHORIZED')
  
  const permissions = ROLE_PERMISSIONS[session.user.role]
  if (!permissions.includes(permission)) throw new Error('FORBIDDEN')
  
  return session.user
}

// Uso en API Route:
// const user = await requirePermission('data:write')
```

## Módulo de administración de usuarios

```
Vistas del admin (/admin/users):
- Lista de usuarios con rol, estado (activo/inactivo), último login
- Crear usuario: nombre, email, contraseña temporal, rol
- Editar usuario: cambiar rol, activar/desactivar
- NO eliminar físicamente — solo desactivar (active: false)
- Log de auditoría por usuario
```

## Seguridad — reglas no negociables
- Passwords: mínimo 8 caracteres, al menos 1 número
- Rate limiting en `/api/auth/signin`: máximo 5 intentos por IP por minuto
- Sesión JWT expira en 8 horas (jornada laboral)
- Cualquier cambio de rol se registra en AuditLog
- Emails únicos en BD — validar antes de crear usuario
- HTTPS obligatorio en producción (Next.js lo maneja en Vercel)
- Variables sensibles SIEMPRE en `.env.local`, nunca en código
