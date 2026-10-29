// Selbstheilung nach einem neuen Build: Ein alter Tab (oder eine Seite aus dem Browser-Cache) verweist auf
// JS-Dateien, die es nicht mehr gibt. Dann einmal neu laden – mit Sperre, damit keine Endlosschleife entsteht.

const KEY = "cortex-reload-at";
const LOCK_MS = 15_000;

const CHUNK_RE = /ChunkLoadError|Loading chunk|Failed to load chunk|dynamically imported module|Importing a module script failed|error loading dynamically/i;

export function isChunkError(err: unknown) {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? "");
  return CHUNK_RE.test(msg);
}

/** Lädt die Seite neu, höchstens einmal je 15 s. Gibt false zurück, wenn gerade erst neu geladen wurde. */
export function healOnce() {
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < LOCK_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Inline-Skript für den <head>: greift, bevor React läuft (fehlende Skripte, Chunk-Fehler außerhalb von React). */
export const HEAL_SCRIPT = `(function(){var K=${JSON.stringify(KEY)},L=${LOCK_MS},R=${CHUNK_RE.toString()};function heal(){try{var t=+sessionStorage.getItem(K)||0;if(Date.now()-t<L)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){return}location.reload()}window.addEventListener('error',function(e){var el=e.target;if(el&&el.tagName==='SCRIPT'&&/\\/_next\\/static\\//.test(el.src||''))heal();else if(R.test(e.message||''))heal()},true);window.addEventListener('unhandledrejection',function(e){var r=e.reason;if(R.test(r&&(r.name+' '+r.message)||String(r)))heal()})})();`;
