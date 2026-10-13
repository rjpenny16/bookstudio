"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useRunnerState } from "@/lib/inbox/runnerState";

const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  { group: "Create", items: [{ href: "/", label: "Projects" }, { href: "/new", label: "New book" }, { href: "/autopilot", label: "AI Autopilot" }, { href: "/inbox", label: "Inbox" }] },
  { group: "Research", items: [{ href: "/research", label: "Research boards" }] },
  { group: "Publish", items: [{ href: "/tools", label: "KDP calculators" }] },
  { group: "Measure", items: [{ href: "/sales", label: "Sales reports" }] },
  { group: "System", items: [{ href: "/settings", label: "Settings" }] },
];

export function Sidebar() {
  const pathname = usePathname();
  const runner = useRunnerState();
  // On phones the links fold away behind a Menu button and close again after a choice.
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setOpen(false);
  }
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(href));
  return (
    <nav className={`sidebar${open ? " open" : ""}`} aria-label="Main">
      <div className="sidebar-top">
        <Link href="/" className="brand" aria-label="BookStudio home">
          <span className="brand-mark" aria-hidden>
            B
          </span>
          BookStudio
        </Link>
        <button className="btn btn-sm btn-ghost menu-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <div id="main-nav" className="nav-links">
        {NAV.map((g) => (
          <div key={g.group} style={{ display: "contents" }}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className="nav-link" aria-current={active(it.href) ? "page" : undefined}>
                {it.label}
                {it.href === "/inbox" && runner.building && (
                  <span className="badge badge-accent" style={{ marginLeft: 6 }} title={`Building "${runner.building}"`}>
                    building
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        Open source · Apache-2.0
        <br />
        Your projects stay in this browser.
      </div>
    </nav>
  );
}
