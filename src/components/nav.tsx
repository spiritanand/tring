"use client";

import { BellRing } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Patient chat" },
  { href: "/desk", label: "Clinic desk" },
] as const;

export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5"
      aria-label="Tring home"
    >
      <BellRing size={18} strokeWidth={1.75} className="text-brand" />
      <span className="text-[20px] font-semibold tracking-[-0.03em]">
        tring<span className="text-brand">.</span>
      </span>
    </Link>
  );
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Pages" className="flex items-center gap-1">
      {LINKS.map((link) => {
        const current = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              current ? "bg-raise text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
