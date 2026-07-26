import { compare } from 'bcryptjs';
import CredentialsProvider from 'next-auth/providers/credentials';
import NextAuth from 'next-auth';

const sharedSecret = process.env.FAMILY_SHARED_SECRET || '';

export const { handlers, auth } = NextAuth({
  trustHost: true,
  providers: [
    CredentialsProvider({
      type: 'credentials',
      credentials: {
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.password) return null;

        const inputPassword = credentials.password as string;

        // Support both plain-text and bcrypt-hashed shared secrets
        if (sharedSecret.startsWith('$2')) {
          const valid = await compare(inputPassword, sharedSecret);
          if (!valid) return null;
        } else if (inputPassword === sharedSecret) {
          // Plain text match
        } else {
          return null;
        }

        return { id: 'family', name: 'Family' };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
});
