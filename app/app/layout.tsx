import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ErrorBoundary from '@/components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'Gospel Study Assistant',
  description: 'Scripture and Church history study application with direct quote retrieval',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-gray-50">
        <Providers>
          <Navbar />
          <ErrorBoundary>
            <main className="flex-1">{children}</main>
          </ErrorBoundary>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
