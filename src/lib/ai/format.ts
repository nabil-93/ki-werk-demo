// Formatierung für deutsche Ausgaben (Server + Client)

export const fmtInt = (n: number) => Math.round(n).toLocaleString("de-DE");
export const fmtNum = (n: number, d = 1) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPct = (n: number, d = 1) => `${fmtNum(n * 100, d)} %`;
export const fmtEur = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;
export const fmtKEur = (n: number) => (Math.abs(n) >= 1_000_000 ? `${fmtNum(n / 1_000_000, 2)} Mio. €` : `${fmtNum(n / 1000, 1)} T€`);

export function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}
export function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}
export function fmtTimeSec(ms: number) {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Berlin" });
}
export function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
}
export function fmtShortDate(ms: number) {
  return new Date(ms).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
}
export function fmtDuration(h: number) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${fmtNum(h, h < 10 ? 1 : 0)} h`;
  return `${fmtNum(h / 24, 1)} Tage`;
}
export function fmtAgo(ms: number, now: number) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${fmtNum(s / 3600, s < 36000 ? 1 : 0)} h`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}
