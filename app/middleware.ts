import { auth } from '@/lib/auth';

export default auth((req) => {
  const isAuthenticated = !!req.auth;

  // Allow unauthenticated access to login page and NextAuth API routes
  if (req.nextUrl.pathname === '/login' || req.nextUrl.pathname.startsWith('/api/auth')) {
    return;
  }

  // Allow static assets
  if (req.nextUrl.pathname.startsWith('/_next/static') ||
      req.nextUrl.pathname.startsWith('/_next/image') ||
      req.nextUrl.pathname === '/favicon.ico') {
    return;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    const newUrl = new URL('/login', req.nextUrl.origin);
    return Response.redirect(newUrl);
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
