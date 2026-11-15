import * as React from "react"

import { fetchProbe, formatDate, type Probe, type SarEvent } from "@/lib/api"
import {
  GROUND_LABEL,
  GROUND_SWATCH,
  colourMeaning,
  groundPairOf,
  levelWords,
  readsAs,
  regionAt,
  signalRatio,
} from "@/lib/reading"
import { cn } from "@/lib/utils"

/** A point under the mouse: map coordinates plus its pixel position in the map container. */
export interface HoverPoint {
  lat: number
  lon: number
  x: number
  y: number
}

interface HoverState extends HoverPoint {
  data: Probe
}

/** How long the mouse rests before the spot is read: no request per pixel while it travels. */
const HOVER_DELAY_MS = 180
/** Readings kept per event, so moving back over a spot answers at once. */
const CACHE_LIMIT = 500
/** Gap between the cursor and the card, px. */
const CURSOR_GAP = 16

const insideBounds = ([[south, west], [north, east]]: SarEvent["bounds"], p: HoverPoint) =>
  p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east

/** True when the device has a mouse (hover makes no sense on touch: there a tap reads the spot). */
function useCanHover() {
  const [can] = React.useState(() => matchMedia("(hover: hover) and (pointer: fine)").matches)
  return can
}

/**
 * Reads the radar under a resting mouse. Returns the reading to show (null while moving or
 * outside the scene) and the handler the map calls on every mouse move.
 */
export function useHoverReading(event: SarEvent | undefined) {
  const canHover = useCanHover()
  const [state, setState] = React.useState<HoverState | null>(null)
  const timer = React.useRef<number | undefined>(undefined)
  const request = React.useRef<AbortController | null>(null)
  const cache = React.useRef(new Map<string, Probe>())

  const cancel = React.useCallback(() => {
    window.clearTimeout(timer.current)
    request.current?.abort()
    request.current = null
  }, [])

  const onHover = React.useCallback(
    (point: HoverPoint | null) => {
      cancel()
      setState(null)
      if (!canHover || !point || !event || !insideBounds(event.bounds, point)) return
      timer.current = window.setTimeout(() => {
        // ~10 m: the same radar pixel, near enough.
        const key = `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`
        const hit = cache.current.get(key)
        if (hit) return setState({ ...point, data: hit })
        const ctrl = new AbortController()
        request.current = ctrl
        fetchProbe(event.id, point.lat, point.lon, ctrl.signal)
          .then((data) => {
            if (cache.current.size >= CACHE_LIMIT) cache.current.clear()
            cache.current.set(key, data)
            setState({ ...point, data })
          })
          // Aborted, outside the analysed box or no data: the card just stays hidden.
          .catch(() => undefined)
      }, HOVER_DELAY_MS)
    },
    [canHover, event, cancel]
  )

  React.useEffect(() => {
    cache.current.clear()
    setState(null)
  }, [event?.id])
  React.useEffect(() => cancel, [cancel])

  return [state, onHover] as const
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

/** Which colours the map shows: the change on the after date, or the ground on both dates. */
export type MapView = "change" | "ground"

function Swatch({ className }: { className: string | null }) {
  return className ? (
    <span
      className={cn("inline-block size-3 shrink-0 rounded-[3px] ring-1 ring-black/15", className)}
    />
  ) : (
    <span className="inline-block size-3 shrink-0 rounded-[3px] border border-muted-foreground/60" />
  )
}

/** The Colour row in the change view: the change class under the cursor and what it means. */
function ChangeColour({ reading, event }: { reading: Probe; event: SarEvent }) {
  const colour = colourMeaning(reading.flag, event)
  return (
    <Row label="Colour">
      <span className="flex items-center gap-2 font-semibold">
        <Swatch className={colour.swatch} />
        {colour.name}
      </span>
      <span className="text-muted-foreground">{colour.meaning}</span>
    </Row>
  )
}

/** The Colour row in the ground view: what the ground was on each date, before → after. */
function GroundColour({ reading, event }: { reading: Probe; event: SarEvent }) {
  const [a, b] = groundPairOf(reading.pre_db ?? 0, reading.post_db ?? 0, reading.flag, event)
  return (
    <Row label="Colour, before → after">
      <span className="flex flex-wrap items-center gap-x-2 font-semibold">
        <span className="flex items-center gap-1.5">
          <Swatch className={GROUND_SWATCH[a]} />
          {GROUND_LABEL[a]}
        </span>
        →
        <span className="flex items-center gap-1.5">
          <Swatch className={GROUND_SWATCH[b]} />
          {GROUND_LABEL[b]}
        </span>
      </span>
      <span className="text-muted-foreground">
        {a !== b
          ? "The ground here turned into something else."
          : reading.flag === "rough_water"
            ? "Water on both dates; wind ruffled it on the after date."
            : "The same kind of ground on both dates."}
      </span>
    </Row>
  )
}

/** What happened at the spot under the mouse: the colour and what it means, the ground on each
 * date in words, the size of the change, and the numbered area it belongs to. */
function Explanation({ reading, event, view }: { reading: Probe; event: SarEvent; view: MapView }) {
  if (reading.pre_db == null || reading.post_db == null || reading.delta_db == null) {
    return (
      <p className="text-muted-foreground">
        No radar measurement here on both dates: the slope hides this spot from the satellite (radar
        shadow), or it lies outside the swath.
      </p>
    )
  }
  const area = regionAt(event.regions, reading.lat, reading.lon)
  const delta = reading.delta_db
  // Wind-ruffled water can rise above the generic "very dark" line while the pipeline still calls
  // it water (ROUGH_MAX_DB); say so instead of naming a land cover.
  const afterWords =
    reading.flag === "rough_water"
      ? "still dark enough to be water, now ruffled by wind"
      : levelWords(reading.post_db, event)
  return (
    <dl className="space-y-2.5">
      {view === "ground" ? (
        <GroundColour reading={reading} event={event} />
      ) : (
        <ChangeColour reading={reading} event={event} />
      )}
      <Row label="What happened here">{readsAs(reading, event)}.</Row>
      <Row label={`Before · ${formatDate(event.pre.datetime)}`}>
        {reading.pre_db.toFixed(1)} dB, {levelWords(reading.pre_db, event)}
      </Row>
      <Row label={`After · ${formatDate(event.post.datetime)}`}>
        {reading.post_db.toFixed(1)} dB, {afterWords}
      </Row>
      <Row label="Change">
        <span className="font-semibold">
          {delta > 0 ? "+" : ""}
          {delta.toFixed(1)} dB
        </span>
        <span className="text-muted-foreground">: this spot now returns {signalRatio(delta)}.</span>
      </Row>
      {area && (
        <Row label={`Numbered area ${area.n}`}>
          One of the places where change is concentrated (1 is the largest)
          {area.km2 ? `: ${area.km2.toFixed(1)} km² changed inside its outline.` : "."}
        </Row>
      )}
    </dl>
  )
}

/** Floating card beside the cursor; flips to stay on screen. Never takes the mouse itself. */
export function HoverCard({
  state,
  event,
  divider,
  width,
  view,
}: {
  state: HoverState | null
  event: SarEvent | undefined
  /** Divider x in px: left of it the map shows the before date, right of it the after date. */
  divider: number
  width: number
  view: MapView
}) {
  if (!state || !event) return null
  const flipX = state.x > width / 2
  const flipY = state.y > window.innerHeight / 2
  const side = state.x < divider ? "before" : "after"
  return (
    <div
      role="tooltip"
      data-testid="hover-reading"
      className="glass pointer-events-none absolute z-[1100] w-[300px] rounded-xl px-4 py-3 text-[13px] leading-snug shadow-lg"
      style={{
        left: state.x,
        top: state.y,
        transform: `translate(${flipX ? `calc(-100% - ${CURSOR_GAP}px)` : `${CURSOR_GAP}px`}, ${
          flipY ? `calc(-100% - ${CURSOR_GAP}px)` : `${CURSOR_GAP}px`
        })`,
      }}
    >
      <Explanation reading={state.data} event={event} view={view} />
      <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
        NISAR radar (NASA-ISRO, L-band). You are on the <b>{side}</b> side of the divider: left
        shows {formatDate(event.pre.datetime)}, right shows {formatDate(event.post.datetime)}.
      </p>
    </div>
  )
}
