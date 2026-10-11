"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  { group: "Create", items: [{ href: "/", label: "Projects" }, { href: "/new", label: "New book" }, { href: "/autopilot", label: "AI Autopilot" }] },
  { group: "Research", items: [{ href: "/research", label: "Research boards" }] },
  { group: "Publish", items: [{ href: "/tools", label: "KDP calculators" }] },
  { group: "Measure", items: [{ href: "/sales", label: "Sales reports" }] },
  { group: "System", items: [{ href: "/settings", label: "Settings" }] },
];

export function Sidebar() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(href));
  return (
    <nav className="sidebar" aria-label="Main">
      <Link href="/" className="brand" aria-label="BookStudio home">
        <span className="brand-mark" aria-hidden>
          B
        </span>
        BookStudio
      </Link>
      {NAV.map((g) => (
        <div key={g.group} style={{ display: "contents" }}>
          <div className="nav-group">{g.group}</div>
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} className="nav-link" aria-current={active(it.href) ? "page" : undefined}>
              {it.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        Open source · Apache-2.0
        <br />
        Your projects stay in this browser.
      </div>
    </nav>
  );
}
