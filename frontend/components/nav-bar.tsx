'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Chat' },
  { href: '/documents', label: 'Documents' },
  { href: '/ingest', label: 'Ingest' },
] as const;

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-10 border-b border-line bg-sage-50/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-verdigris text-[13px] font-semibold text-white"
          >
            R
          </span>
          <span className="font-display text-[17px] font-medium tracking-tight text-ink">
            Verdigris
            <span className="ms-1.5 text-xs font-normal tracking-normal text-faint">
              RAG console
            </span>
          </span>
        </Link>

        <div className="ms-auto flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === '/'
                ? pathname === '/'
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-verdigris-soft text-verdigris-dark'
                    : 'text-muted hover:bg-sage-200 hover:text-ink',
                ].join(' ')}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
