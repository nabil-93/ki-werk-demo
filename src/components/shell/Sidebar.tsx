"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Euro,
  Factory,
  FileText,
  Radio,
  Warehouse,
  Handshake,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Truck,
  Workflow,
} from "lucide-react";
import { useUi } from "@/lib/client/store";
import { cn } from "@/lib/client/cn";
import { LogoMark } from "./Logo";

export const NAV = [
  {
    group: "Übersicht",
    items: [
      { href: "/", label: "Leitstand · Digitaler Zwilling", short: "Leitstand", icon: LayoutDashboard },
      { href: "/lage", label: "Lagebericht · live", short: "Lagebericht", icon: Radio, ai: true },
    ],
  },
  {
    group: "Fachbereiche",
    items: [
      { href: "/produktion", label: "Produktion", short: "Produktion", icon: Factory },
      { href: "/waechter", label: "Maschinengesundheit · KI-Wächter", short: "KI-Wächter", icon: ShieldCheck, ai: true },
      { href: "/qualitaet", label: "Qualität & Vision", short: "Qualität", icon: ScanEye },
      { href: "/vertrieb", label: "Vertrieb & Liefertermine", short: "Vertrieb", icon: Handshake },
      { href: "/lager", label: "Lager & LKW-Hof", short: "Lager", icon: Warehouse },
      { href: "/logistik", label: "Logistik & Material", short: "Logistik", icon: Truck },
    ],
  },
  {
    group: "Management",
    items: [
      { href: "/bericht", label: "Berichte · Tag/Woche/Monat", short: "Berichte", icon: FileText },
      { href: "/finanzen", label: "Finanzen & Kunden", short: "Finanzen", icon: Euro },
    ],
  },
  {
    group: "KI-Plattform",
    items: [
      { href: "/werksexperte", label: "KI-Werksexperte", short: "Experte", icon: Sparkles, ai: true },
      { href: "/daten", label: "Datenintegration", short: "Daten", icon: Workflow },
    ],
  },
];

export function pageTitle(pathname: string) {
  for (const g of NAV) for (const it of g.items) if (it.href === pathname) return it.label;
  return "KI-Werk";
}

export default function Sidebar() {
  const pathname = usePathname();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  // Nur eine kompakte Signatur abonnieren – Sidebar rendert nicht bei jedem Live-Update neu
  const sig = useUi((s) => {
    const snap = s.snap;
    if (!snap) return "";
    return [
      // KI-Wächter: Befunde mit Handlungsbedarf (Warnung/kritisch)
      snap.guard.findings.filter((f) => f.sev !== "info").length,
      snap.machines.filter((m) => m.spcViolation || m.scrapRate > 0.025).length,
      snap.orders.filter((o) => o.risk === "gefaehrdet").length + snap.inquiries.filter((i) => i.status === "OFFEN").length,
      snap.materials.filter((m) => m.state !== "ok").length,
      snap.machines.filter((m) => m.status === "STOERUNG").length,
      snap.tickets.filter((t) => t.status === "ENTWURF").length,
      snap.yard.overstay + snap.stock.filter((x) => x.state === "crit").length,
    ].join(",");
  });
  const [bW, bQ, bV, bL, bP, bC, bY] = sig ? sig.split(",").map(Number) : [0, 0, 0, 0, 0, 0, 0];
  const badges: Record<string, number> = { "/waechter": bW, "/qualitaet": bQ, "/vertrieb": bV, "/logistik": bL, "/produktion": bP, "/werksexperte": bC, "/lager": bY };
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 68 : 248 }}
      transition={{ type: "tween", duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="relative z-30 flex h-full shrink-0 flex-col border-r border-line bg-panel"
    >
      {/* Griff an der Kante: Leiste ein-/ausklappen (Taste [) */}
      <button
        onClick={toggle}
        title={collapsed ? "Leiste ausklappen ([)" : "Leiste einklappen ([)"}
        aria-label={collapsed ? "Leiste ausklappen" : "Leiste einklappen"}
        className="absolute -right-3 top-[60px] z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-panel text-muted shadow-[var(--shadow-sm)] transition-colors hover:border-faint hover:text-ink"
      >
        <ChevronLeft size={14} className={cn("transition-transform duration-300", collapsed && "rotate-180")} />
      </button>
      <div className={cn("flex h-[60px] items-center gap-2.5 border-b border-line-2 px-4", collapsed && "justify-center px-0")}>
        <LogoMark size={30} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="wide truncate text-[14px] font-bold tracking-[-0.02em]">
              <span className="ai-text">KI</span>-Werk
            </div>
            <div className="truncate text-[10.5px] text-muted">Unternehmens-KI · Prototyp</div>
          </div>
        )}
      </div>

      <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-3">
            {!collapsed && <div className="label px-2.5 pb-1.5 pt-1 text-[9.5px]">{g.group}</div>}
            {g.items.map((it) => {
              const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
              const Icon = it.icon;
              const badge = badges[it.href] ?? 0;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  title={collapsed ? it.label : undefined}
                  className={cn(
                    "group relative mb-0.5 flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
                    collapsed && "justify-center px-0",
                    active ? "text-ink" : "text-muted hover:bg-panel-2 hover:text-ink",
                  )}
                >
                  {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg border border-line bg-panel-2" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
                  {active && <motion.span layoutId="nav-bar" className="absolute -left-2.5 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
                  <Icon size={17} strokeWidth={1.8} className={cn("relative shrink-0", "ai" in it && it.ai && "text-accent")} />
                  {!collapsed && <span className="relative truncate">{it.label}</span>}
                  {badge > 0 && (
                    <span
                      className={cn(
                        "num relative ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                        it.href === "/werksexperte" ? "bg-accent" : "bg-crit",
                        collapsed && "absolute right-1 top-0.5 ml-0 h-4 min-w-4",
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line-2 p-2.5">
        {!collapsed && (
          <div className="mb-2 rounded-lg bg-panel-2 px-3 py-2.5">
            <div className="text-[11px] font-semibold text-ink-2">Prototyp</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-muted">Unternehmens-KI · simulierte Werksdaten</div>
          </div>
        )}
        <button onClick={toggle} className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12px] text-muted hover:bg-panel-2 hover:text-ink", collapsed && "justify-center px-0")}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && "Einklappen"}
        </button>
      </div>
    </motion.aside>
  );
}
