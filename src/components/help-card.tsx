import { XIcon } from "lucide-react"
import * as React from "react"

/** First-visit guide to the map controls; reopened with the "?" button on the toolbar. */
export function HelpCard({ onClose, left }: { onClose: () => void; left: number }) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const steps: [string, string][] = [
    [
      "Pick a place",
      "Choose an event in the panel on the left: a flood, a fire, a glacier, an earthquake.",
    ],
    [
      "Compare the two dates",
      "Left of the round handle is the first picture, right of it the second. Drag the handle across.",
    ],
    [
      "Before & after / Only changes",
      "Before & after colours what the land was on each date. Only changes colours just the spots that changed.",
    ],
    [
      "Learn the colours",
      "Click any colour in the bar above the buttons to see what it means and what causes it.",
    ],
    ["Read a spot", "Rest your mouse on the map (or tap) to read what happened right there."],
  ]
  return (
    <div
      role="dialog"
      aria-label="How to use this map"
      className="pointer-events-auto absolute bottom-[10.5rem] w-[min(92vw,440px)] -translate-x-1/2 rounded-xl border bg-card px-5 py-4 text-[13px] leading-snug text-card-foreground shadow-lg sm:bottom-[8.5rem]"
      style={{ left }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] font-semibold">How to use this map</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className="-mt-1 -mr-2 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <p className="mt-1 text-muted-foreground">
        A radar satellite (NISAR) photographed the same place twice. Radar sees through clouds and
        smoke, and shows how rough or wet the ground is, so it can spot floods, burns and
        landslides.
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              {i + 1}
            </span>
            <span>
              <b>{title}.</b> <span className="text-muted-foreground">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full rounded-md bg-primary py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
      >
        Got it
      </button>
    </div>
  )
}
