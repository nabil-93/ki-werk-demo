// Zeit-Helfer: alle Anzeigen in Europe/Berlin, unabhängig vom Server.

export const H = 3_600_000;
export const MIN = 60_000;

const partsFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  weekday: "short",
});

export function berlin(ms: number) {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  const hour = Number(p.hour) % 24;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: p.weekday,
  };
}

/** Beginn des Produktionstags (06:00 Uhr) für einen Zeitpunkt */
export function productionDayStart(ms: number) {
  const b = berlin(ms);
  const sinceSix = ((b.hour - 6 + 24) % 24) * H + b.minute * MIN + b.second * 1000;
  return ms - sinceSix - (ms % 1000);
}

export function shiftOf(ms: number) {
  const b = berlin(ms);
  const h = b.hour;
  const base = ms - (b.minute * MIN + b.second * 1000 + (ms % 1000));
  if (h >= 6 && h < 14) return { name: "Frühschicht", start: base - (h - 6) * H, end: base + (14 - h) * H };
  if (h >= 14 && h < 22) return { name: "Spätschicht", start: base - (h - 14) * H, end: base + (22 - h) * H };
  const sinceStart = (h - 22 + 24) % 24;
  return { name: "Nachtschicht", start: base - sinceStart * H, end: base + (8 - sinceStart) * H };
}

/** Nächster Schichtwechsel nach ms */
export function nextShiftChange(ms: number) {
  return shiftOf(ms).end;
}

/** Zeitpunkt "in d Tagen um hh:00" (Berlin) */
export function atDayHour(fromMs: number, days: number, hour: number) {
  const b = berlin(fromMs);
  const midnight = fromMs - (b.hour * H + b.minute * MIN + b.second * 1000 + (fromMs % 1000));
  return midnight + days * 24 * H + hour * H;
}
