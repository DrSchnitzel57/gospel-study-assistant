'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

export default function Navbar() {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch {
      // Not logged in
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/login';
  }

  if (loading) {
    return (
      <nav className="bg-primary-dark text-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-xl font-bold">Gospel Study Assistant</Link>
        </div>
      </nav>
    );
  }

  return (
    <nav className="bg-primary-dark text-white px-6 py-4 shadow-md">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold hover:text-primary-light transition-colors">
          Gospel Study Assistant
        </Link>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <span className="text-sm text-gray-300">
                {user.username}
                {user.role === 'admin' && (
                  <span className="ml-2 px-2 py-0.5 bg-accent text-xs rounded">Admin</span>
                )}
              </span>
              <Link href="/admin" className="text-sm hover:text-primary-light transition-colors">
                Admin
              </Link>
              <button
                onClick={handleLogout}
                className="text-sm bg-primary hover:bg-primary-light px-3 py-1.5 rounded transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <Link href="/login" className="text-sm bg-primary hover:bg-primary-light px-3 py-1.5 rounded transition-colors">
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
