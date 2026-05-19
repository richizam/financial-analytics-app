import { NextAuthOptions } from 'next-auth'
import AzureADProvider from 'next-auth/providers/azure-ad'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/prisma'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID ?? 'common',
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: 'openid profile email offline_access Files.Read User.Read',
        },
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    CredentialsProvider({
      id: 'credentials',
      name: 'Demo',
      credentials: {
        username: { label: 'Usuario', type: 'text', placeholder: 'demo' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        const demoUser = process.env.DEMO_USER ?? 'demo'
        const demoPassword = process.env.DEMO_PASSWORD

        if (!demoPassword) return null

        if (
          credentials?.username === demoUser &&
          credentials?.password === demoPassword
        ) {
          return {
            id: 'demo-user',
            name: 'Demo User',
            email: `${demoUser}@demo.local`,
          }
        }
        return null
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
      }
      // Guardar access token de Microsoft para acceder a OneDrive
      if (account?.provider === 'azure-ad') {
        token.msAccessToken  = account.access_token
        token.msRefreshToken = account.refresh_token
        token.msTokenExpiry  = account.expires_at
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
      }
      session.msAccessToken = token.msAccessToken as string | undefined
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
    error:  '/auth/error',
  },
}
