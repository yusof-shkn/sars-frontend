import { Combobox } from "@base-ui/react/combobox"
import type { Map as LeafletMap } from "leaflet"
import * as React from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  CircleHelpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayersIcon,
  MinusIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  RadarIcon,
  ScanIcon,
  SearchIcon,
  SunIcon,
  XIcon,
} from "lucide-react"

import { ChangeHistogram } from "@/components/change-histogram"
import {
  BASEMAPS,
  ChangeMap,
  SWIPE_HANDLE,
  swipeX,
  type FitOptions,
  opticalDates,
  type Basemap,
} from "@/components/change-map"
import { ColourKey } from "@/components/colour-key"
import { HelpCard } from "@/components/help-card"
import { HoverCard, useHoverReading, type MapView } from "@/components/hover-reading"
import { StoryCard } from "@/components/story-panel"
import { Skeleton } from "@/components/ui/skeleton"
import {
  fetchProbe,
  fileUrl,
  formatDate,
  useApi,
  type EventSummary,
  type Granule,
  type Probe,
  type Region,
  type SarEvent,
} from "@/lib/api"
import { changeKey, groundKey } from "@/lib/colour-key"
import { friendlyArea, howToRead, plainDates, plainSummary } from "@/lib/plain"
import { CLASS_SWATCH, HAZARD, doubleBounce, readsAs, wording } from "@/lib/reading"
import { cn } from "@/lib/utils"

/* ---------- small pieces ---------- */

function useStored<T extends string>(key: string, fallback: () => T) {
  const [value, setValue] = React.useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback()
    } catch {
      return fallback()
    }
  })
  React.useEffect(() => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage blocked: the setting just won't survive a reload */
    }
  }, [key, value])
  return [value, setValue] as const
}

function useTheme() {
  const [theme, setTheme] = useStored<"light" | "dark">("theme", () =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  )
  const dark = theme === "dark"
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])
  return [dark, () => setTheme(dark ? "light" : "dark")] as const
}

const WIDE = "(min-width: 768px)"

/** True on screens wide enough for the details panel to sit beside the map's working area. */
function useWide() {
  const [wide, setWide] = React.useState(() => matchMedia(WIDE).matches)
  React.useEffect(() => {
    const m = matchMedia(WIDE)
    const on = () => setWide(m.matches)
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [])
  return wide
}

/** Live width of an element (callback ref, so it works for elements that mount later). */
function useWidth() {
  const [width, setWidth] = React.useState(0)
  const observer = React.useRef<ResizeObserver | null>(null)
  const ref = React.useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(([e]) =>
      setWidth(e.borderBoxSize?.[0]?.inlineSize ?? e.contentRect.width)
    )
    observer.current.observe(el)
  }, [])
  return [ref, width] as const
}

/** Left sidebar: 12px margin + 400px + 12px gap. The map never moves for it; the divider, the
 * toolbar and zoom-to-area just keep clear of it while it is open. */
const SIDEBAR_INSET = 424

/** Surfaces over the map. Panels are the content; the toolbar and chips are controls. */
const panel = "glass pointer-events-auto rounded-2xl"
const bar = "glass pointer-events-auto rounded-xl"
const label = "text-xs font-medium text-muted-foreground"
const iconBtn =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none disabled:opacity-40 sm:size-9"

function Swatch({ className }: { className: string }) {
  return <span className={cn("inline-block size-3 shrink-0 rounded-[3px]", className)} />
}

/** Area/number formatting that never turns a real non-zero value into "0". */
const num = (v?: number | null, d = 1) =>
  v == null
    ? undefined
    : v > 0 && v < 0.01
      ? "<0.01"
      : v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 1 ? 2 : d })

/* ---------- wording ---------- */

/** The detailed, measured sentence. */
function headline(e: SarEvent) {
  const [down, up] = wording(e.hazard)
  const s = e.stats
  const n = (v: number) => num(v) ?? "0"
  const when = `Between ${formatDate(e.pre.datetime)} and ${formatDate(e.post.datetime)}`
  const parts: string[] = []
  const shown = (v: number | null | undefined) => (v ?? 0) >= 0.05
  if (shown(s.decrease_km2)) {
    const water = shown(s.open_water_km2)
      ? `, ${n(s.open_water_km2)} km² of it down to water level`
      : ""
    parts.push(`${n(s.decrease_km2)} km² got darker: ${down}${water}`)
  }
  // The split of the brighter class by mechanism is in the colour table right below.
  if (shown(s.increase_km2) && s.increase_km2 >= 0.05 * s.decrease_km2)
    parts.push(`${n(s.increase_km2)} km² got brighter, consistent with ${up}`)
  return parts.length
    ? `${when}, ${parts.join("; ")}.`
    : `${when}, nothing in the ${n(s.aoi_km2)} km² scene changed by more than ±${e.threshold_db} dB.`
}

/* ---------- map furniture ---------- */

/** Draggable divider knob. Pointer capture keeps the drag alive once the cursor leaves the knob;
 * the map underneath keeps its own pan/zoom because only this 40px circle takes events. */
function SwipeHandle({
  split,
  onChange,
  left,
  min,
}: {
  split: number
  onChange: (v: number) => void
  /** Divider x in px (from swipeX). */
  left: number
  /** Smallest split the knob may take: it stops at the open sidebar instead of going under it. */
  min: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const clamp = (v: number) => Math.min(1, Math.max(min, v))
  const dragTo = (clientX: number) => {
    const area = ref.current?.parentElement?.getBoundingClientRect()
    if (!area) return
    onChange(
      clamp((clientX - area.left - SWIPE_HANDLE / 2) / Math.max(1, area.width - SWIPE_HANDLE))
    )
  }
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Swipe between before and after"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split * 100)}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragTo(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) dragTo(e.clientX)
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02
        if (e.key === "ArrowLeft") onChange(clamp(split - step))
        else if (e.key === "ArrowRight") onChange(clamp(split + step))
        else if (e.key === "Home") onChange(min)
        else if (e.key === "End") onChange(1)
        else return
        e.preventDefault()
      }}
      className="absolute top-1/2 z-10 flex size-10 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-card outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ left }}
    >
      <ChevronLeftIcon className="size-4" />
      <ChevronRightIcon className="size-4" />
    </div>
  )
}

/** Which colours the map paints: the ground on both dates, or the change on the after date. */
function ViewSwitch({ view, onChange }: { view: MapView; onChange: (v: MapView) => void }) {
  // [view, label, short label for phones, tooltip]
  const options: [MapView, string, string, string][] = [
    [
      "ground",
      "Before & after",
      "Land",
      "Colour what the land looked like on each date: water, bare ground, fields, bright",
    ],
    [
      "change",
      "Only changes",
      "Changes",
      "Colour only the spots that changed between the two dates",
    ],
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Map colours"
      className="flex h-9 items-center rounded-md bg-muted/60 p-0.5"
    >
      {options.map(([v, text, short, tip]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          aria-label={text}
          title={tip}
          onClick={() => onChange(v)}
          className={cn(
            "h-8 rounded-[5px] px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            view === v
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{text}</span>
        </button>
      ))}
    </div>
  )
}

function Toggle({
  on,
  onChange,
  label: text,
  compact,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  /** Switch only (name stays as the accessible label and tooltip). */
  compact?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={text}
      title={compact ? text : undefined}
      onClick={() => onChange(!on)}
      className="flex h-9 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring outline-none sm:px-2.5"
    >
      <span
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted-foreground/35"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-white transition-[left]",
            on ? "left-3.5" : "left-0.5"
          )}
        />
      </span>
      <span className={cn("hidden whitespace-nowrap", !compact && "sm:inline")}>{text}</span>
    </button>
  )
}

/** Legend and numbers in one table: each class the map draws, what it means, and its area. */
function ClassTable({ event }: { event: SarEvent }) {
  const s = event.stats
  const t = event.threshold_db
  const rows: [string, string, number | null | undefined][] = event.cross_pol
    ? [
        ["bg-decrease", `Darker by ${t} dB or more`, s.decrease_km2],
        [
          "bg-increase",
          `Double bounce: ${doubleBounce(event.hazard)}`,
          s.increase_double_bounce_km2,
        ],
        ["bg-volume", "Growth or rougher ground", s.increase_volume_km2],
        ["bg-rough", "Wind on open water", s.increase_rough_water_km2],
      ]
    : [
        ["bg-decrease", `Darker by ${t} dB or more`, s.decrease_km2],
        ["bg-increase", `Brighter by ${t} dB or more`, s.increase_km2],
      ]
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">Change classes and their area</caption>
      <tbody>
        {/* A class with no pixels has no colour on the map, so it gets no row either. */}
        {rows
          .filter(([, , km2]) => (km2 ?? 0) > 0)
          .map(([sw, text, km2]) => (
            <tr key={text} className="border-b border-foreground/10 last:border-0">
              <td className="w-5 py-1.5 align-top">
                <Swatch className={cn("mt-0.5", sw)} />
              </td>
              <td className="py-1.5 pr-3 leading-snug">{text}</td>
              <td className="py-1.5 text-right font-semibold whitespace-nowrap">
                {num(km2 ?? 0)} <span className="font-normal text-muted-foreground">km²</span>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  )
}

/** Kinds of change inside an area: key, swatch, plain name, and the words a search accepts
 * (the technical names too, so "double bounce" still finds them). */
const ZONE_PARTS: [keyof NonNullable<Region["breakdown"]>, string, string, string[]][] = [
  ["decrease", "bg-decrease", "darker", ["darker", "water"]],
  ["increase", "bg-increase", "brighter (walls, trunks)", ["brighter", "walls", "double bounce"]],
  ["volume", "bg-volume", "rougher or greener", ["rougher", "greener", "growth"]],
]

/** Search the areas: a number finds that area (1 finds 1, 10, 11...); a word finds every area
 * holding that kind of change, the one with the most of it first. */
function searchAreas(regions: Region[], query: string): Region[] {
  if (!query) return regions
  if (/^\d+$/.test(query)) return regions.filter((r) => String(r.n).startsWith(query))
  const part = ZONE_PARTS.find(([, , , words]) =>
    words.some((w) => w.startsWith(query) || query.startsWith(w))
  )
  if (!part) return []
  const [k] = part
  return regions
    .filter((r) => (r.breakdown?.[k] ?? 0) > 0)
    .sort((a, b) => (b.breakdown?.[k] ?? 0) - (a.breakdown?.[k] ?? 0))
}

/** Areas of concentrated change, largest first; clicking one zooms the map to its outline. */
function RegionList({ regions, onPick }: { regions: Region[]; onPick: (r: Region) => void }) {
  if (!regions.length) return null
  return (
    <ol className="flex flex-col">
      {regions.map((r) => {
        const parts = ZONE_PARTS.filter(([k]) => r.breakdown?.[k])
        return (
          <li key={r.n}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring outline-none"
            >
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-foreground text-[10px] leading-none font-bold">
                {r.n}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{num(r.km2)} km² changed</span>
                  {r.share_pct != null && (
                    <span className="text-xs text-muted-foreground">{r.share_pct}% of all</span>
                  )}
                </span>
                {r.breakdown && (
                  <span className="flex h-1.5 overflow-hidden rounded-full bg-foreground/10">
                    {parts.map(([k, sw]) => (
                      <span
                        key={k}
                        className={sw}
                        style={{ width: `${(100 * r.breakdown![k]!) / r.km2}%` }}
                      />
                    ))}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {parts.map(([k, , name]) => `${num(r.breakdown![k])} ${name}`).join(", ")}
                  {r.extent_km2 != null ? `, across ${num(r.extent_km2)} km² of land` : ""}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** The numbered areas in their own scrolling box, with a search by number or by what changed. */
function AreaSearch({ event, onPick }: { event: SarEvent; onPick: (r: Region) => void }) {
  const [q, setQ] = React.useState("")
  React.useEffect(() => setQ(""), [event.id])
  const shown = searchAreas(event.regions, q.trim().toLowerCase())
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background/40">
      <label className="relative flex items-center border-b border-foreground/10">
        <SearchIcon className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <span className="sr-only">Search areas</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by number, or darker, brighter, rougher"
          className="h-10 w-full bg-transparent pr-3 pl-9 text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div data-testid="area-list" className="max-h-80 overflow-y-auto p-1">
        {shown.length ? (
          <RegionList regions={shown} onPick={onPick} />
        ) : (
          <p className="px-3 py-4 text-[13px] text-muted-foreground">No area matches “{q}”.</p>
        )}
      </div>
      <p className="border-t border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground">
        {shown.length === event.regions.length
          ? `${event.regions.length} areas`
          : `${shown.length} of ${event.regions.length} areas`}
      </p>
    </div>
  )
}

/** A heading and a few plain sentences. */
function PlainSection({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section className="flex flex-col gap-2 px-1">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed">
        {lines.map((l) => (
          <li key={l} className="flex gap-2">
            <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" />
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The numbered places in plain words, with the searchable list. */
function AreasSection({ event, onPick }: { event: SarEvent; onPick: (r: Region) => void }) {
  const rule = event.area_rule
  if (!rule) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">Numbered places</h2>
      {event.regions.length > 0 ? (
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            The places where the change is packed together, biggest first. Together they hold{" "}
            {rule.coverage_pct}% of all the change ({friendlyArea(rule.total_km2)}). Click one to
            fly there.
          </p>
          <AreaSearch event={event} onPick={onPick} />
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          None: the {friendlyArea(rule.total_km2)} that changed is spread thinly, with no place
          where it is packed together.
        </p>
      )}
    </section>
  )
}

/** How the numbered places are defined, for the technical section. */
function AreaRule({ event }: { event: SarEvent }) {
  const rule = event.area_rule
  if (!rule) return null
  const denser =
    rule.density_x_mean === 1
      ? `more of the land changed than the scene's average of ${rule.scene_density_pct}%`
      : `the share of land that changed is at least ${rule.density_x_mean}× the scene's average of ${rule.scene_density_pct}%`
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">Areas of concentrated change</h2>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Every place where {denser}, measured over {rule.window_km} km and split into compact areas
        of at least {rule.min_km2} km² of change (watershed around density peaks). Together they
        hold {rule.coverage_pct}% of the {num(rule.total_km2)} km² of changed land. Wind on open
        water is not counted.
      </p>
    </section>
  )
}

/* ---------- drawer sections ---------- */

function Reading({ event }: { event: SarEvent }) {
  const [down, up] = wording(event.hazard)
  return (
    <section className="flex flex-col gap-3 text-[13px] leading-relaxed">
      <h2 className="text-[15px] font-semibold">Reading the radar</h2>
      <p className="text-muted-foreground">
        NISAR's L-band radar sees through cloud, smoke and darkness. Rough ground and vegetation
        bounce its signal back and look bright. Calm water reflects it away and looks dark.
      </p>
      <p className="text-muted-foreground">
        Darker by {event.threshold_db} dB or more is consistent with {down}. Brighter is consistent
        with {up}.
      </p>
      {event.cross_pol && (
        <p className="text-muted-foreground">
          This mode also recorded the cross-polarised channel (HV), which tells the brighter cases
          apart. Pixels that brightened but stay water-dark are open water roughened by wind. Among
          the rest, a corner reflection between a flat surface and something upright (water and
          stems, bare ground and trunks, walls) lifts HH well above HV: {doubleBounce(event.hazard)}
          . Growth or a rougher surface lifts both alike.
        </p>
      )}
      {event.layers.subtle && (
        <p className="text-muted-foreground">
          Landscape 500 m shows change too small for any single pixel but consistent over hundreds
          of metres: the average change in 500 m blocks of land, compared with the scene as a whole
          {event.stats.subtle_threshold_db != null
            ? `, highlighted beyond ±${event.stats.subtle_threshold_db} dB`
            : ""}
          . It is a relative picture, not an area count: unchanged land can drift by about half a
          decibel across a scene (calibration bands, soil moisture), so read the pattern, not the
          exact edge. A boreal fire leaves trunks and soil standing, so each pixel moves by only
          about +1 dB; at this scale the burn stands out.
        </p>
      )}
      {event.layers.before_rgb && (
        <p className="text-muted-foreground">
          Radar has no colour of its own. Colour (HH/HV) is a false-colour composite: red is HH,
          green is HV, blue is their ratio. Vegetation turns green-yellow, calm water dark blue,
          flooded vegetation and buildings red to magenta, or yellow-orange where HV is strong too.
        </p>
      )}
      <p className="border-t pt-3 text-[13px] text-muted-foreground">
        This is a change map, not a damage assessment or forecast. Wet soil, wind on water and radar
        shadow can also change the signal. Only the radar layers come from NISAR; the basemaps and
        photos do not.
      </p>
    </section>
  )
}

function Provenance({ event }: { event: SarEvent }) {
  const rows: [string, (g: Granule) => React.ReactNode][] = [
    ["Granule", (g) => g.id],
    ["Acquired (UTC)", (g) => g.datetime.replace("T", " ").replace(/\..*|Z$/, "")],
    ["Polarization", (g) => g.polarization],
    ["Track / frame", (g) => (g.track != null ? `${g.track} / ${g.frame ?? "—"}` : null)],
    ["Orbit", (g) => g.orbit_direction],
    ["Product version", (g) => g.product_version],
    ["Release", (g) => (g.maturity ? `${g.maturity}${g.crid ? ` (${g.crid})` : ""}` : null)],
    ["Orbit data", (g) => g.orbit_quality],
    ["Frame", (g) => g.frame_coverage],
  ]
  const provisional = [event.pre, event.post].some((g) => g.maturity && g.maturity !== "VALIDATED")
  const files = [
    ["before.png", event.layers.before],
    ["after.png", event.layers.after],
    ["change.png", event.layers.change],
    ["event.json", `/files/events/${event.id}/event.json`],
  ] as const
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[15px] font-semibold">Data and method</h2>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {event.product}. 5×5 speckle filter, log-ratio of the two dates, 5×5 majority filter. Scene
        noise σ {event.stats.noise_sigma_db} dB, threshold ±{event.threshold_db} dB
        {event.threshold_auto ? " (three times the scene noise)" : ""}.
      </p>
      {provisional && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          These are NISAR PROVISIONAL products: fully calibrated, but validated only at a limited
          set of sites, with near-real-time orbit data. NASA plans a VALIDATED reprocessing of these
          dates in 2027.
        </p>
      )}
      <table className="w-full table-fixed text-[13px]">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="w-28 py-2 font-medium" />
            <th className="py-2 font-medium">Before</th>
            <th className="py-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, get]) => (
            <tr key={name} className="border-b last:border-0 align-top">
              <th className="py-2 pr-2 text-left font-normal text-muted-foreground">{name}</th>
              <td className="py-2 pr-3 text-[12px] break-all">{get(event.pre) ?? "—"}</td>
              <td className="py-2 text-[12px] break-all">{get(event.post) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span className="text-muted-foreground">Download</span>
        {files.map(([name, path]) => (
          <a
            key={name}
            href={fileUrl(path)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {name}
          </a>
        ))}
      </p>
    </section>
  )
}

/** Pick the event: a dropdown with a search field (title or hazard). */
function EventPicker({
  events,
  current,
  onSelect,
}: {
  events: EventSummary[]
  current?: string
  onSelect: (id: string) => void
}) {
  const items = React.useMemo(
    () =>
      Combobox.createItems(events, {
        getValue: (e) => e.id,
        getLabel: (e) => `${e.title} ${HAZARD[e.hazard] ?? e.hazard}`,
      }),
    [events]
  )
  const now = events.find((e) => e.id === current)
  const when = (e: EventSummary) =>
    `${HAZARD[e.hazard] ?? e.hazard}, ${formatDate(e.pre_date)} to ${formatDate(e.post_date)}`
  return (
    <Combobox.Root items={items} value={current ?? null} onValueChange={(id) => id && onSelect(id)}>
      <Combobox.Trigger
        aria-label="Choose an event"
        className="flex w-full items-center gap-3 rounded-xl border border-foreground/10 bg-background/50 px-3 py-2 text-left transition-colors outline-none hover:bg-background/80 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-background/80"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold">
            {now ? `${now.synthetic ? "Demo: " : ""}${now.title}` : "Choose an event"}
          </span>
          {now && <span className="truncate text-xs text-muted-foreground">{when(now)}</span>}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={6} className="z-50 outline-none">
          <Combobox.Popup
            aria-label="Events"
            className="glass flex w-[var(--anchor-width)] max-w-[var(--available-width)] origin-[var(--transform-origin)] flex-col overflow-hidden rounded-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <label className="relative flex items-center border-b border-foreground/10">
              <SearchIcon className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
              <Combobox.Input
                placeholder="Search events"
                className="h-10 w-full bg-transparent pr-3 pl-9 text-[13px] outline-none placeholder:text-muted-foreground"
              />
            </label>
            <Combobox.Empty>
              <p className="px-3 py-4 text-[13px] text-muted-foreground">No event matches.</p>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto p-1 empty:p-0">
              {(e: EventSummary) => (
                <Combobox.Item
                  key={e.id}
                  value={e.id}
                  data-event={e.id}
                  className="grid cursor-default grid-cols-[1rem_1fr] items-start gap-2 rounded-lg px-2.5 py-2 outline-none select-none data-highlighted:bg-foreground/5"
                >
                  <Combobox.ItemIndicator className="mt-0.5 text-primary">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                  <span className="col-start-2 flex flex-col gap-0.5">
                    <span className="text-[13px] leading-snug font-semibold">
                      {e.synthetic ? "Demo: " : ""}
                      {e.title}
                    </span>
                    <span className="text-xs text-muted-foreground">{when(e)}</span>
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

/** The one sidebar, on the left over the map: brand, theme and its own open/close button on
 * top, then the events, then everything about the open event. Glass, full height. */
function Sidebar({
  open,
  onClose,
  dark,
  onTheme,
  events,
  event,
  onSelect,
  subtle,
  onPick,
}: {
  open: boolean
  onClose: () => void
  dark: boolean
  onTheme: () => void
  events: EventSummary[]
  event?: SarEvent
  onSelect: (id: string) => void
  subtle: boolean
  onPick: (r: Region) => void
}) {
  const scroller = React.useRef<HTMLDivElement>(null)
  // A new event starts at its details, not at the last event's scroll position.
  // (Braces matter: Chrome's scrollTo returns a promise, which React would take for a cleanup.)
  React.useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [event?.id])
  const s = event?.stats
  return (
    <aside
      aria-label="Events and details"
      aria-hidden={!open}
      inert={!open}
      className={cn(
        panel,
        "absolute inset-2 z-30 flex flex-col overflow-hidden transition-[transform,opacity] duration-300 ease-out md:inset-y-3 md:right-auto md:left-3 md:w-[400px]",
        open
          ? "translate-x-0 opacity-100"
          : "pointer-events-none -translate-x-[calc(100%+1rem)] opacity-0"
      )}
    >
      <div className="flex items-center gap-2 border-b border-foreground/10 py-2 pr-2 pl-4">
        <RadarIcon className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="flex-1 text-[15px] font-bold tracking-tight">SAR Change Watch</span>
        <button
          type="button"
          onClick={onTheme}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          className={iconBtn}
        >
          {dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sidebar"
          title="Close sidebar"
          className={iconBtn}
        >
          <PanelLeftCloseIcon className="size-4" />
        </button>
      </div>
      <div className="border-b border-foreground/10 p-3">
        <EventPicker events={events} current={event?.id} onSelect={onSelect} />
      </div>
      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-7 px-4 py-5">
          {event && s && (
            <>
              <header className="flex flex-col gap-2 px-1">
                <h1 className="text-xl leading-snug font-bold tracking-tight text-balance">
                  {event.title}
                </h1>
                <p className={label}>{plainDates(event)}</p>
                {event.synthetic && (
                  <p className="text-xs font-medium text-destructive">
                    Synthetic demo: simulated, not NISAR data
                  </p>
                )}
                {(event.location || event.description) && (
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {[event.location, event.description].filter(Boolean).join(". ")}
                  </p>
                )}
              </header>

              <PlainSection title="What happened" lines={plainSummary(event)} />
              <PlainSection title="How to read the map" lines={howToRead(event)} />

              <div className="px-1">
                <AreasSection event={event} onPick={onPick} />
              </div>

              <details className="group rounded-xl border border-foreground/10 px-4 py-3 open:pb-5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[15px] font-semibold select-none [&::-webkit-details-marker]:hidden">
                  <ChevronRightIcon className="size-4 transition-transform group-open:rotate-90" />
                  Technical details
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    for experts
                  </span>
                </summary>
                <div className="mt-4 flex flex-col gap-7">
                  <p className="text-[14px] leading-relaxed">{headline(event)}</p>
                  <section className="flex flex-col gap-2">
                    <h2 className="text-[15px] font-semibold">Change classes</h2>
                    <ClassTable event={event} />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {num(s.aoi_km2)} km² analysed, {num(s.changed_pct)}% of it changed by{" "}
                      {event.threshold_db} dB or more
                      {event.threshold_auto ? " (three times the scene noise)" : ""}.
                      {s.masked_km2 > 0
                        ? ` ${num(s.masked_km2)} km² dark on both dates was left out.`
                        : ""}
                      {s.water_line_db != null
                        ? ` Open water in this scene is below ${s.water_line_db} dB, a line taken from its own histogram.`
                        : ""}
                    </p>
                    {event.suspects && event.suspects.length > 0 && (
                      <p className="flex gap-2 text-xs text-destructive">
                        <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
                        {num(event.suspects.reduce((a, r) => a + r.km2, 0))} km² shifted by the same
                        amount in HH and HV, which ground change rarely does. Check it against
                        another date before trusting it.
                      </p>
                    )}
                    {subtle && s.subtle_threshold_db != null && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Landscape 500 m is on: average change in 500 m blocks compared with the
                        whole scene, orange above and blue below ±{s.subtle_threshold_db} dB.
                      </p>
                    )}
                    {event.pixel_m != null && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Pixel size {event.pixel_m} m
                        {(event.looks ?? 1) > 1
                          ? `: ${event.looks}×${event.looks} pixels averaged to fit the processing computer's memory.`
                          : " (full resolution)."}
                      </p>
                    )}
                  </section>

                  {event.area_rule && <AreaRule event={event} />}

                  <section className="flex flex-col gap-2">
                    <h2 className="text-[15px] font-semibold">How much each pixel changed</h2>
                    <p className="text-[13px] text-muted-foreground">
                      Number of pixels by change in signal strength, square-root scale. The dashed
                      lines mark the ±{event.threshold_db} dB threshold.
                    </p>
                    <ChangeHistogram event={event} />
                  </section>

                  <Reading event={event} />
                  <Provenance event={event} />
                </div>
              </details>

              <p className="mx-1 border-t border-foreground/10 pt-4 text-[12px] leading-relaxed text-muted-foreground">
                Built for the NASA Space Apps Challenge 2026, Dancing with the SARs. Radar: NISAR
                (NASA and ISRO), distributed by the Alaska Satellite Facility. Photos: NASA GIBS
                (HLS from Landsat 8/9 and Sentinel-2; MODIS Terra). Basemaps: Esri, Maxar, Earthstar
                Geographics, © OpenStreetMap contributors. Map library: Leaflet.
              </p>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

/* ---------- page ---------- */

/** What a visitor sees first: this event, only the changes, with the Landscape 500 m layer on,
 * over the dated satellite photos. */
const DEFAULT_EVENT = "thunder-bay-36"
const DEFAULT_VIEW: MapView = "change"
const DEFAULT_BASEMAP: Basemap = "hls"
const DEFAULT_LANDSCAPE = true

export default function App() {
  const [dark, toggleDark] = useTheme()
  const wide = useWide()
  const events = useApi<EventSummary[]>("/events")
  const [selected, setSelected] = React.useState<string>()
  // Opens on the default event when it is there, else on the first in the list.
  const eventId =
    selected ?? (events.data?.find((e) => e.id === DEFAULT_EVENT) ?? events.data?.[0])?.id
  const { data: event, error } = useApi<SarEvent>(eventId ? `/events/${eventId}` : null)

  const [map, setMap] = React.useState<LeafletMap | null>(null)
  // Expose the map to the browser tests (e2e/areas.py reads its view after a click).
  React.useEffect(() => {
    ;(window as unknown as { __map?: LeafletMap | null }).__map = map
  }, [map])
  // The sidebar floats over the left of the map, open by default on wide screens. Opening or
  // closing it changes nothing on the map: no resize, no refit, the divider stays put.
  const [open, setOpen] = React.useState(() => matchMedia(WIDE).matches)
  const covered = wide && open ? SIDEBAR_INSET : 0
  const [mapRef, mapW] = useWidth()
  const width = mapW || window.innerWidth
  // Divider at the sidebar's edge: the visible map is the after side, change colours and all;
  // drag the knob right to reveal the before date. It never goes under the open sidebar, and it
  // stays where it is when the sidebar closes.
  const minSplit = Math.min(1, covered / Math.max(1, width - SWIPE_HANDLE))
  const [split, setSplit] = React.useState(() =>
    matchMedia(WIDE).matches ? SIDEBAR_INSET / Math.max(1, window.innerWidth - SWIPE_HANDLE) : 0
  )
  const divider = swipeX(Math.max(split, minSplit), width)
  const [beforeRef, beforeW] = useWidth()
  const [afterRef, afterW] = useWidth()
  const fit: FitOptions = {
    paddingTopLeft: [covered + 32, 72],
    paddingBottomRight: [32, 96],
  }
  const [showChange, setShowChange] = React.useState(true)
  const [showAreas, setShowAreas] = React.useState(true)
  const [opacity, setOpacity] = React.useState(0.9)
  const [basemap, setBasemap] = React.useState<Basemap>(DEFAULT_BASEMAP)
  const [colour, setColour] = React.useState(false)
  const [subtle, setSubtle] = React.useState(DEFAULT_LANDSCAPE)
  const [probe, setProbe] = React.useState<{
    lat: number
    lon: number
    data?: Probe
    error?: string
  } | null>(null)

  const onProbe = React.useCallback(
    (lat: number, lon: number) => {
      if (!eventId) return
      setProbe({ lat, lon })
      fetchProbe(eventId, lat, lon)
        .then((data) => setProbe((p) => (p && p.lat === lat ? { ...p, data } : p)))
        .catch((e: Error) => setProbe((p) => (p && p.lat === lat ? { ...p, error: e.message } : p)))
    },
    [eventId]
  )
  React.useEffect(() => setProbe(null), [eventId])
  const [hover, onHover] = useHoverReading(event)
  const [viewChoice, setView] = React.useState<MapView>(DEFAULT_VIEW)
  // Events processed before the ground layer existed only have the change view.
  const hasGround = !!event?.layers.before_ground && !!event?.stats.ground
  const view: MapView = hasGround ? viewChoice : "change"
  // The how-to card opens by itself on a first visit, then only from the "?" button.
  const [helpSeen, setHelpSeen] = useStored<"yes" | "no">("helpSeen", () => "no")
  const [showHelp, setShowHelp] = React.useState(() => helpSeen === "no")
  const closeHelp = React.useCallback(() => {
    setShowHelp(false)
    setHelpSeen("yes")
  }, [setHelpSeen])

  const onRegion = React.useCallback(
    (r: Region) => {
      if (!map) return
      // On a phone the sidebar covers the map: get it out of the way first.
      if (!wide) setOpen(false)
      // Land the whole area on the after side: right of the divider and the open sidebar, left
      // of the pixel reading (bottom-right), between the date chips and the toolbar.
      map.flyToBounds(
        r.box ?? [
          [r.lat, r.lon],
          [r.lat, r.lon],
        ],
        {
          paddingTopLeft: [Math.max(divider, covered) + 48, 112],
          paddingBottomRight: [wide ? 310 : 24, wide ? 96 : 200],
          duration: 0.8,
        }
      )
      onProbe(r.lat, r.lon)
    },
    [map, onProbe, divider, covered, wide]
  )

  // The story is a guided tour: null is the opening card, a number is one step. Each step flies
  // the map to its place and switches to the layers it talks about.
  const [storyIndex, setStoryIndex] = React.useState<number | null>(null)
  const [storyOpen, setStoryOpen] = React.useState(true)
  React.useEffect(() => {
    setStoryIndex(null)
    setStoryOpen(true)
  }, [eventId])
  const onStoryIndex = React.useCallback(
    (i: number | null) => {
      setStoryIndex(i)
      if (!map || !event) return
      const p = i == null ? null : event.story?.points[i]
      if (!p) {
        map.flyToBounds(event.bounds, { ...fit, duration: 0.8 })
        return
      }
      const show = p.show
      if (show?.view) setView(show.view)
      if (show?.subtle != null) setSubtle(show.subtle)
      if (show?.basemap && show.basemap in BASEMAPS) setBasemap(show.basemap as Basemap)
      if (show?.radar_opacity != null) {
        setOpacity(show.radar_opacity)
        // With the radar hidden to show the photos, the change colours would float on them.
        setShowChange(show.radar_opacity > 0)
      }
      // 0 = all after, 1 = all before, measured over the part of the map the sidebar leaves free.
      if (show?.split != null) setSplit(minSplit + show.split * (1 - minSplit))
      setProbe(null)
      // Clear of the sidebar on the left, the story card on the right and the bars below.
      const padding = {
        paddingTopLeft: [covered + 40, 80] as [number, number],
        paddingBottomRight: [wide ? 440 : 24, wide ? 170 : 230] as [number, number],
        duration: 0.9,
      }
      const region = p.area == null ? null : event.regions.find((r) => r.n === p.area)
      // A step about the whole scene (zoom below 11) frames the scene; a place gets ~1.5 km.
      const d = 0.014
      const target: [[number, number], [number, number]] =
        region?.box ??
        (p.zoom < 11
          ? event.bounds
          : [
              [p.lat - d, p.lon - d],
              [p.lat + d, p.lon + d],
            ])
      map.flyToBounds(target, padding)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, event, covered, wide, minSplit]
  )

  const failure = events.error ?? error
  const empty = events.data?.length === 0
  const [optPre, optPost] = event ? opticalDates(event, basemap) : [null, null]
  const chipDate = (radar: string, opt: { date: string } | null) =>
    opt && opt.date !== radar.slice(0, 10)
      ? `${formatDate(radar)}, photo ${formatDate(opt.date)}`
      : BASEMAPS[basemap].dated && !opt
        ? `${formatDate(radar)}, no photo`
        : formatDate(radar)
  // A date chip shows only when it fits on its own side of the divider, clear of the sidebar.
  const showBefore = divider - 12 - beforeW >= covered + 8
  const showAfter = divider + 12 + afterW <= width - 8
  // The toolbar centres on the part of the map the sidebar leaves free; short of room, the
  // switches drop their labels.
  const free = width - covered
  const tight = free < 1100 // drop the opacity slider, narrow the basemap picker
  const compact = free < 820 // switches without labels

  return (
    <div className="relative h-svh w-full overflow-hidden bg-background">
      <div ref={mapRef} data-testid="map" className="absolute inset-0">
        {event ? (
          <ChangeMap
            event={event}
            showChange={showChange}
            showAreas={showAreas}
            opacity={opacity}
            dark={dark}
            basemap={basemap}
            onMap={setMap}
            probe={probe}
            onProbe={onProbe}
            colour={colour}
            subtle={subtle}
            onRegion={onRegion}
            fit={fit}
            divider={divider}
            onHover={onHover}
            view={view}
            storyIndex={storyIndex}
            onStoryPoint={onStoryIndex}
          />
        ) : (
          <Skeleton className="absolute inset-0 rounded-none bg-muted" />
        )}
        {event && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white shadow-card"
              style={{ left: divider }}
            />
            <div
              aria-hidden
              data-testid="chip-before"
              className="pointer-events-none absolute top-[4.5rem] z-10 -translate-x-full pr-3 transition-opacity"
              style={{ left: divider, opacity: showBefore ? 1 : 0 }}
            >
              <span
                ref={beforeRef}
                className={cn(bar, "inline-flex items-baseline gap-1.5 px-2.5 py-1 text-[13px]")}
              >
                <span className="text-muted-foreground">Before</span>
                <span className="font-semibold whitespace-nowrap">
                  {chipDate(event.pre.datetime, optPre)}
                </span>
              </span>
            </div>
            <div
              aria-hidden
              data-testid="chip-after"
              className="pointer-events-none absolute top-[4.5rem] z-10 pl-3 transition-opacity"
              style={{ left: divider, opacity: showAfter ? 1 : 0 }}
            >
              <span
                ref={afterRef}
                className={cn(bar, "inline-flex items-baseline gap-1.5 px-2.5 py-1 text-[13px]")}
              >
                <span className="text-muted-foreground">After</span>
                <span className="font-semibold whitespace-nowrap">
                  {chipDate(event.post.datetime, optPost)}
                </span>
              </span>
            </div>
            <SwipeHandle
              split={Math.max(split, minSplit)}
              onChange={setSplit}
              left={divider}
              min={minSplit}
            />
          </>
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 z-20">
        {/* Closed sidebar: the same button brings it back, at the same corner. */}
        <div
          className={cn(
            bar,
            "absolute top-3 left-3 flex items-center gap-1 p-1 transition-opacity duration-300",
            open && "pointer-events-none opacity-0"
          )}
          aria-hidden={open}
          inert={open}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open sidebar"
            title="Open sidebar"
            className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-semibold transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
          >
            <PanelLeftOpenIcon className="size-4" />
            <span className="hidden max-w-[220px] truncate sm:inline">
              {event?.title ?? "SAR Change Watch"}
            </span>
          </button>
          <button
            type="button"
            onClick={toggleDark}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            className={iconBtn}
          >
            {dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
          </button>
        </div>

        <Sidebar
          open={open}
          onClose={() => setOpen(false)}
          dark={dark}
          onTheme={toggleDark}
          events={events.data ?? []}
          event={event}
          onSelect={(id) => {
            setSelected(id)
            if (!wide) setOpen(false)
          }}
          subtle={subtle}
          onPick={onRegion}
        />

        {/* Pixel reading: bottom-right, above the toolbar row, clear of the sidebar. */}
        {probe && event && (
          <div
            className={cn(panel, "absolute right-4 bottom-[9.5rem] w-[270px] sm:bottom-[8.25rem]")}
          >
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-[13px] font-semibold">Pixel reading</span>
              <button
                type="button"
                onClick={() => setProbe(null)}
                aria-label="Close pixel reading"
                className="-mr-2 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <div className="px-4 py-3 text-[13px]" data-testid="probe">
              {probe.error ? (
                <p className="text-muted-foreground">
                  {probe.error === "Outside the analysed area"
                    ? "This spot is outside the area the radar analysed."
                    : probe.error}
                </p>
              ) : !probe.data ? (
                <p className="text-muted-foreground">Reading…</p>
              ) : probe.data.pre_db === null ? (
                <p className="text-muted-foreground">No radar measurement here on both dates.</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Before</dt>
                  <dd>{probe.data.pre_db.toFixed(1)} dB</dd>
                  <dt className="text-muted-foreground">After</dt>
                  <dd>{probe.data.post_db?.toFixed(1)} dB</dd>
                  <dt className="text-muted-foreground">Change</dt>
                  <dd className="flex items-center gap-2 font-semibold">
                    {(probe.data.delta_db ?? 0) > 0 ? "+" : ""}
                    {probe.data.delta_db?.toFixed(1)} dB
                    {probe.data.flag && <Swatch className={CLASS_SWATCH[probe.data.flag]} />}
                  </dd>
                  {probe.data.hv_pre_db != null && probe.data.hv_post_db != null && (
                    <>
                      <dt className="text-muted-foreground">HV</dt>
                      <dd>
                        {probe.data.hv_pre_db.toFixed(1)} → {probe.data.hv_post_db.toFixed(1)} dB
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Reads as</dt>
                  <dd>{readsAs(probe.data, event)}</dd>
                </dl>
              )}
            </div>
          </div>
        )}

        {event && (
          <ColourKey
            title={view === "ground" ? "Before & after" : "Only changes"}
            hint={
              view === "ground"
                ? "What the land looked like on each date. Numbers: area before → after. Click a colour."
                : "Spots that changed between the two dates, shown on the second date. Click a colour."
            }
            entries={view === "ground" ? groundKey(event) : changeKey(event)}
            left={covered + free / 2}
          />
        )}

        {event?.story && storyOpen && !showHelp && (
          <StoryCard
            story={event.story}
            event={event}
            index={storyIndex}
            onIndex={onStoryIndex}
            onClose={() => {
              setStoryOpen(false)
              setStoryIndex(null)
            }}
          />
        )}
        {event?.story && !storyOpen && (
          <button
            type="button"
            onClick={() => setStoryOpen(true)}
            className="pointer-events-auto absolute top-14 right-3 z-20 rounded-full bg-[#c2410c] px-4 py-2 text-[13px] font-bold text-white shadow-lg hover:bg-[#9a3412]"
          >
            ▶ The story
          </button>
        )}
        {showHelp && <HelpCard onClose={closeHelp} left={covered + free / 2} />}

        {/* Toolbar */}
        <div
          data-testid="toolbar"
          className={cn(
            bar,
            // Never wider than the screen: on a phone the switches scroll sideways inside the bar.
            "absolute bottom-12 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto p-1 transition-[left] duration-300 sm:bottom-5"
          )}
          style={{ left: covered + free / 2 }}
        >
          <button
            type="button"
            aria-label="How to use this map"
            title="How to use this map"
            aria-expanded={showHelp}
            onClick={() => (showHelp ? closeHelp() : setShowHelp(true))}
            className={iconBtn}
          >
            <CircleHelpIcon className="size-4" />
          </button>
          {hasGround && (
            <>
              <ViewSwitch view={view} onChange={setView} />
              <span className="mx-0.5 h-5 w-px bg-border" />
            </>
          )}
          {view === "change" && (
            <Toggle on={showChange} onChange={setShowChange} label="Change" compact={compact} />
          )}
          {event && event.regions.length > 0 && (
            <Toggle on={showAreas} onChange={setShowAreas} label="Areas" compact={compact} />
          )}
          {view === "change" && event?.layers.subtle && (
            <Toggle on={subtle} onChange={setSubtle} label="Landscape 500 m" compact={compact} />
          )}
          {view === "change" && event?.layers.before_rgb && (
            <Toggle on={colour} onChange={setColour} label="Colour (HH/HV)" compact={compact} />
          )}
          <label className={cn("hidden h-9 items-center gap-2 px-2.5", !tight && "sm:flex")}>
            <span className="text-[13px] font-medium">Radar</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-20 accent-primary"
              aria-label="Radar layer opacity"
            />
          </label>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <label className="relative flex h-9 items-center">
            <LayersIcon className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
            <select
              value={basemap}
              onChange={(e) => setBasemap(e.target.value as Basemap)}
              aria-label="Basemap"
              className={cn(
                "h-9 w-20 appearance-none truncate rounded-md bg-transparent py-0 pr-6 pl-8 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                !compact && (tight ? "sm:w-40 sm:pr-7 sm:pl-9" : "sm:w-auto sm:pr-7 sm:pl-9")
              )}
            >
              {(Object.keys(BASEMAPS) as Basemap[]).map((k) => (
                <option key={k} value={k}>
                  {BASEMAPS[k].label}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
          </label>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!map}
            onClick={() => map?.zoomOut()}
            className={cn(iconBtn, "max-sm:hidden")}
          >
            <MinusIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={!map}
            onClick={() => map?.zoomIn()}
            className={cn(iconBtn, "max-sm:hidden")}
          >
            <PlusIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Fit the event in view"
            disabled={!map || !event}
            onClick={() => event && map?.fitBounds(event.bounds, fit)}
            className={iconBtn}
          >
            <ScanIcon className="size-4" />
          </button>
        </div>

        {(failure || empty) && (
          <div
            className={cn(
              panel,
              "absolute top-1/2 left-1/2 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 px-6 py-8 text-center"
            )}
          >
            <p className="text-xl font-semibold">
              {failure ? "The data server isn't responding" : "No events yet"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {failure
                ? `${failure}. Start sars-backend on ${import.meta.env.VITE_API_URL ?? "localhost:8000"} and reload.`
                : "Process a GCOV pair with the pipeline in sars-backend."}
            </p>
          </div>
        )}
      </div>
      <HoverCard state={hover} event={event} divider={divider} width={width} view={view} />
    </div>
  )
}
