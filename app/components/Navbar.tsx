'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';

export default function Navbar() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="bg-primary-dark text-white px-4 sm:px-6 py-3 sm:py-4 shadow-md">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href="/search" className="text-lg sm:text-xl font-bold hover:text-primary-light transition-colors">
          Gospel Study
        </Link>

        <div className="hidden md:flex items-center gap-4">
          <Link href="/search" className="text-sm hover:text-primary-light transition-colors">
            Search
          </Link>
          <Link href="/history" className="text-sm hover:text-primary-light transition-colors">
            History Guide
          </Link>
          <Link href="/status" className="text-sm hover:text-primary-light transition-colors">
            Status
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-sm bg-primary hover:bg-primary-light px-3 py-1.5 rounded transition-colors"
          >
            Sign Out
          </button>
        </div>

        <button
          className="md:hidden p-2"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden mt-3 pb-2 border-t border-primary/30 pt-3 space-y-2">
          <Link href="/search" className="block px-3 py-2 text-sm hover:bg-primary/20 rounded" onClick={() => setMenuOpen(false)}>
            Search
          </Link>
          <Link href="/history" className="block px-3 py-2 text-sm hover:bg-primary/20 rounded" onClick={() => setMenuOpen(false)}>
            History Guide
          </Link>
          <Link href="/status" className="block px-3 py-2 text-sm hover:bg-primary/20 rounded" onClick={() => setMenuOpen(false)}>
            Status & Ingestion
          </Link>
          <button
            onClick={() => { signOut({ callbackUrl: '/login' }); setMenuOpen(false); }}
            className="block w-full text-left px-3 py-2 text-sm hover:bg-primary/20 rounded"
          >
            Sign Out
          </button>
        </div>
      )}
    </nav>
  );
}
