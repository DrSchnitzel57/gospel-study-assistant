'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';

export default function Navbar() {
  return (
    <nav className="bg-primary-dark text-white px-6 py-4 shadow-md">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href="/search" className="text-xl font-bold hover:text-primary-light transition-colors">
          Gospel Study Assistant
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/search" className="text-sm hover:text-primary-light transition-colors">
            Search
          </Link>
          <Link href="/history" className="text-sm hover:text-primary-light transition-colors">
            History Guide
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-sm bg-primary hover:bg-primary-light px-3 py-1.5 rounded transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
}
