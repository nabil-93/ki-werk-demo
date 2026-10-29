"use client";

import { Fragment, type ReactNode } from "react";

// Schlanker Markdown-Renderer für Copilot-Antworten (fett, Code, Listen, Überschriften, Quellen-Chips)

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[A-Z]{2,3}-[A-Z]{2,3}-\d{3}[^\]]*\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${key}b${i}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={`${key}c${i}`}>{tok.slice(1, -1)}</code>);
    else
      out.push(
        <span key={`${key}q${i}`} className="num mx-0.5 inline-flex items-center rounded border border-accent/30 bg-accent-soft px-1 py-px align-[1px] text-[10px] font-semibold text-accent-ink">
          {tok.slice(1, -1)}
        </span>,
      );
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) {
      const k = `l${blocks.length}`;
      blocks.push(
        <ul key={k}>
          {list.map((l, i) => (
            <li key={i}>{inline(l, `${k}${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      const txt = para.join(" ");
      const isRec = /^Empfehlung:/i.test(txt);
      blocks.push(
        isRec ? (
          <p key={k} className="!mt-2.5 rounded-lg border border-accent/25 bg-accent-soft/60 px-3 py-2 text-ink">
            {inline(txt, k)}
          </p>
        ) : (
          <p key={k}>{inline(txt, k)}</p>
        ),
      );
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (li) {
      flushPara();
      list.push(li[1]);
    } else if (h) {
      flushPara();
      flushList();
      blocks.push(<h4 key={`h${blocks.length}`}>{inline(h[1], `h${blocks.length}`)}</h4>);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if (/^\|/.test(line)) {
      flushPara();
      flushList();
      // Tabellenzeilen schlicht darstellen
      if (/^\|[\s:\-|]+\|$/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      blocks.push(
        <div key={`t${blocks.length}`} className="grid gap-2 border-b border-line-2 py-1 text-[12px]" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0,1fr))` }}>
          {cells.map((c, i) => (
            <span key={i} className="truncate">
              {inline(c, `t${blocks.length}${i}`)}
            </span>
          ))}
        </div>,
      );
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return (
    <div className={`md text-[13.5px] leading-[1.6] text-ink-2 ${streaming ? "caret" : ""}`}>
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
