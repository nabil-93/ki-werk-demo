export function LogoMark({ size = 30 }: { size?: number }) {
  // Becher-Silhouette (Verpackung) mit neuronalen Knoten (KI)
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path d="M8.5 9.5h15l-2.1 14.2a2 2 0 0 1-2 1.7h-6.8a2 2 0 0 1-2-1.7L8.5 9.5Z" stroke="var(--bg)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 9.5h17" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="13" cy="15" r="1.6" fill="url(#lg)" />
      <circle cx="19" cy="14" r="1.6" fill="url(#lg)" />
      <circle cx="16" cy="20.5" r="1.6" fill="url(#lg)" />
      <path d="M13 15l3 5.5M19 14l-3 6.5M13 15l6-1" stroke="url(#lg)" strokeWidth="1" opacity="0.9" />
      <defs>
        <linearGradient id="lg" x1="10" y1="12" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--ai-1)" />
          <stop offset="1" stopColor="var(--ai-2)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
