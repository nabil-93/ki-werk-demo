"use client";

import { motion } from "framer-motion";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/client/cn";
import type { MachineStatus, Severity, SourceSystem } from "@/lib/sim/types";

export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  ai,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  ai?: boolean;
}) {
  return (
    <section className={cn("panel flex min-w-0 flex-col", ai && "ai-border", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon && <div className="mt-0.5 text-muted">{icon}</div>}
            <div className="min-w-0">
              {title && <h3 className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>}
              {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 px-4 pb-4", !title && !actions && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

const SEV: Record<Severity, string> = {
  ok: "bg-ok-soft text-ok",
  info: "bg-accent-soft text-accent-ink",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
};

export function Badge({ sev = "info", children, className, dot }: { sev?: Severity | "neutral"; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4",
        sev === "neutral" ? "bg-panel-3 text-ink-2" : SEV[sev],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const STATUS_META: Record<MachineStatus, { label: string; sev: Severity | "neutral"; color: string }> = {
  PRODUKTION: { label: "Produktion", sev: "ok", color: "var(--ok)" },
  RUESTEN: { label: "Rüsten", sev: "neutral", color: "var(--muted)" },
  STOERUNG: { label: "Störung", sev: "crit", color: "var(--crit)" },
  WARTUNG: { label: "Wartung", sev: "info", color: "var(--accent)" },
  STILLSTAND: { label: "Stillstand", sev: "neutral", color: "var(--faint)" },
};

export function StatusPill({ status, className }: { status: MachineStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <Badge sev={m.sev} className={className}>
      <span className="relative flex h-1.5 w-1.5">
        {status === "STOERUNG" && <span className="pulse-ring absolute inset-0 rounded-full text-crit" />}
        <span className="relative h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      {m.label}
    </Badge>
  );
}

export function StatusDot({ sev, pulse, className }: { sev: Severity | "neutral"; pulse?: boolean; className?: string }) {
  const color = sev === "ok" ? "text-ok" : sev === "warn" ? "text-warn" : sev === "crit" ? "text-crit" : sev === "info" ? "text-accent" : "text-faint";
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", color, className)}>
      {pulse && <span className="pulse-ring absolute inset-0 rounded-full" />}
      <span className="relative h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

const SRC_COLOR: Record<SourceSystem, string> = {
  MES: "#7a8796",
  IoT: "#0f9fb5",
  SAP: "#2b59ff",
  CAQ: "#9b51e0",
  WMS: "#c07a12",
  TMS: "#4f7d2a",
  CMMS: "#c2410c",
  KI: "#2b59ff",
  CRM: "#be185d",
};

export function SourceTag({ source, className }: { source: SourceSystem; className?: string }) {
  return (
    <span
      className={cn("num inline-flex h-[18px] items-center rounded-[5px] border px-1.5 text-[9.5px] font-semibold tracking-wide", className)}
      style={{ color: SRC_COLOR[source], borderColor: `color-mix(in srgb, ${SRC_COLOR[source]} 35%, transparent)`, background: `color-mix(in srgb, ${SRC_COLOR[source]} 8%, transparent)` }}
    >
      {source === "KI" ? "KI" : source}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  className,
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "ai";
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-semibold transition-[background,box-shadow,transform,opacity] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "bg-ink text-bg hover:opacity-90",
        variant === "secondary" && "border border-line bg-panel text-ink shadow-[var(--shadow-sm)] hover:bg-panel-2",
        variant === "ghost" && "text-ink-2 hover:bg-panel-3",
        variant === "danger" && "bg-crit text-white hover:opacity-90",
        variant === "ai" && "bg-[linear-gradient(110deg,var(--ai-1),var(--ai-2))] text-white shadow-[0_6px_18px_-6px_var(--ai-1)] hover:brightness-110",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className, size = "md" }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; className?: string; size?: "sm" | "md" }) {
  const id = useId();
  return (
    <div className={cn("inline-flex rounded-lg border border-line bg-panel-2 p-0.5", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn("relative rounded-md font-semibold transition-colors", size === "sm" ? "px-2 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12.5px]", value === it.value ? "text-ink" : "text-muted hover:text-ink-2")}
        >
          {value === it.value && <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-md bg-panel shadow-[var(--shadow-sm)]" transition={{ type: "spring", bounce: 0.18, duration: 0.45 }} />}
          <span className="relative">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, sev, className, height = 6 }: { value: number; sev?: Severity | "neutral"; className?: string; height?: number }) {
  const color = sev === "crit" ? "var(--crit)" : sev === "warn" ? "var(--warn)" : sev === "ok" ? "var(--ok)" : sev === "neutral" ? "var(--faint)" : "var(--accent)";
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-panel-3", className)} style={{ height }}>
      <motion.div className="h-full rounded-full" style={{ background: color }} initial={false} animate={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num rounded-[5px] border border-line bg-panel px-1.5 py-px text-[10px] font-semibold text-muted">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label truncate">{label}</div>
      <div className="num mt-1 truncate text-[19px] font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, desc, actions }: { eyebrow?: ReactNode; title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="label mb-1.5 flex items-center gap-2">{eyebrow}</div>}
        <h1 className="wide text-[26px] font-bold leading-[1.1] tracking-[-0.025em] text-ink">{title}</h1>
        {desc && <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function sevForRisk(p: number): Severity {
  return p >= 0.75 ? "crit" : p >= 0.45 ? "warn" : p >= 0.2 ? "info" : "ok";
}

export function Empty({ icon, title, desc }: { icon?: ReactNode; title: string; desc?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <div className="text-[13px] font-semibold text-ink-2">{title}</div>
      {desc && <div className="max-w-xs text-[12px] text-muted">{desc}</div>}
    </div>
  );
}
