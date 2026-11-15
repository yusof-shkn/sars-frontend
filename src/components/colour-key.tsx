import { XIcon } from "lucide-react"
import * as React from "react"

import type { KeyEntry } from "@/lib/colour-key"
import { cn } from "@/lib/utils"

/** The open entry's explanation, above the chips. */
function Explanation({ entry, onClose }: { entry: KeyEntry; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={`What ${entry.name} means`}
      className="pointer-events-auto mb-2 w-[min(92vw,420px)] rounded-xl border bg-card px-4 py-3 text-[13px] leading-snug text-card-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <span
            className={cn(
              "inline-block size-3.5 shrink-0 rounded-[3px] ring-1 ring-black/15",
              entry.swatch
            )}
          />
          {entry.name}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close explanation"
          className="-mt-1 -mr-2 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-muted-foreground">{entry.shows}</p>
      <p className="mt-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        What it can mean here
      </p>
      <p className="mt-0.5">{entry.meaning}</p>
      <p className="mt-2.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Usual causes
      </p>
      <ul className="mt-0.5 list-disc pl-4">
        {entry.causes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {entry.measured && <p className="mt-2.5 border-t pt-2 font-medium">{entry.measured}</p>}
    </div>
  )
}

/**
 * Every colour on the map, one chip each, with its numbers; a click explains it. Sits above the
 * toolbar, centred on the free part of the map.
 */
export function ColourKey({
  title,
  hint,
  entries,
  left,
}: {
  /** What the colours are, e.g. "Only changes". */
  title: string
  /** One plain sentence on what the colours show and that they can be clicked. */
  hint: string
  entries: KeyEntry[]
  /** Centre x in px. */
  left: number
}) {
  const [open, setOpen] = React.useState<string | null>(null)
  const current = entries.find((e) => e.id === open)

  // A new set of colours (other event or view) closes the explanation.
  const ids = entries.map((e) => e.id).join(",")
  React.useEffect(() => setOpen(null), [ids, title])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  if (!entries.length) return null
  return (
    <div
      className="pointer-events-none absolute bottom-[6.25rem] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col items-center transition-[left] duration-300 sm:bottom-[4.5rem]"
      style={{ left }}
      data-testid="colour-key"
    >
      {current && <Explanation entry={current} onClose={() => setOpen(null)} />}
      <div className="glass pointer-events-auto flex max-w-full flex-col rounded-xl p-1">
        <p className="px-2 pt-1 pb-0.5 text-[11px] leading-snug text-muted-foreground">
          <b className="font-semibold text-foreground">{title}:</b> {hint}
        </p>
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto">
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              aria-expanded={open === e.id}
              onClick={() => setOpen(open === e.id ? null : e.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                open === e.id && "bg-accent"
              )}
            >
              <span
                className={cn(
                  "inline-block size-3 shrink-0 rounded-[3px] ring-1 ring-black/15",
                  e.swatch
                )}
              />
              <span className="leading-tight">
                <span className="block text-[12px] font-medium whitespace-nowrap">{e.name}</span>
                {e.figure && (
                  <span className="block text-[11px] whitespace-nowrap text-muted-foreground">
                    {e.figure}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
