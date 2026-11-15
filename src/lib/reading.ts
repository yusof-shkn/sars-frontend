/** Plain-language readings of the radar: what a change class, a backscatter level and a change in
 * dB mean on the ground. Shared by the sidebar, the click reading and the hover card so they
 * always say the same thing. */
import type { GroundClass, Probe, Region, SarEvent } from "@/lib/api"

export type ChangeClass = Region["cls"]

/** What a backscatter drop / rise most plausibly means, per hazard. Plain words, no claims. */
const WORDING: Record<string, [string, string]> = {
  flood: [
    "standing water or smoothed ground",
    "wetter soil, flooded vegetation, growing crops or wind on water",
  ],
  fire: ["burn scars with lost canopy", "exposed rough ground, standing trunks or regrowth"],
  deforestation: ["cleared land", "new structures"],
  landslide: ["smoothed, bare ground such as fresh mud", "debris, boulders or rubble"],
  lake: [
    "a smoother or wetter surface: wet snow, standing water or a calm lake",
    "a rougher surface: rockfall, debris, frozen ground, lake ice or wind on the lake",
  ],
  earthquake: [
    "smoothed or wetter ground: liquefaction mud, or ground that slid or was flattened",
    "rubble, landslide debris, or broken and rougher ground",
  ],
  glacier: [
    "wet snow, melting ice, meltwater or a smoothed surface",
    "avalanche debris, broken ice or freshly exposed rock",
  ],
  farmland: [
    "harvested or ploughed fields: crops cut down to bare soil",
    "crops growing taller and leafier, or wetter, rougher soil",
  ],
}

export const wording = (hazard?: string): [string, string] =>
  WORDING[hazard ?? ""] ?? [
    "standing water or smoother ground",
    "wetter soil, rougher ground or new structures",
  ]

/** What an HH-above-HV rise (a corner reflection) most plausibly is, per hazard. */
const DOUBLE_BOUNCE: Record<string, string> = {
  flood: "flooded vegetation",
  fire: "standing trunks over bare ground",
  deforestation: "stems or structures",
  landslide: "boulders, wreckage or damaged buildings",
  lake: "rock blocks or ice edges",
  earthquake: "collapsed or tilted buildings, or rubble",
  glacier: "ice blocks, crevasse walls or seracs",
  farmland: "tall crop stems over wet or irrigated soil",
}

export const doubleBounce = (hazard?: string) =>
  DOUBLE_BOUNCE[hazard ?? ""] ?? "double bounce (stems, walls)"

/** Display names of the hazard types, for the event picker. */
export const HAZARD: Record<string, string> = {
  flood: "Flood",
  fire: "Wildfire",
  deforestation: "Deforestation",
  landslide: "Landslide / debris flow",
  lake: "Lake watch",
  earthquake: "Earthquake",
  glacier: "Glacier",
  farmland: "Farmland",
}

/** Tailwind background class of each change colour (see --change-* in index.css). */
export const CLASS_SWATCH: Record<ChangeClass, string> = {
  decrease: "bg-decrease",
  increase: "bg-increase",
  volume: "bg-volume",
  rough_water: "bg-rough",
}

/** Open-water level when the event did not record its own (pipeline WATER_DB). */
const DEFAULT_WATER_DB = -16

/** Plain-language reading of one probed pixel. */
export function readsAs(p: Probe, event: SarEvent): string {
  const [down, up] = wording(event.hazard)
  const post = p.post_db ?? 0
  const water = event.stats.water_line_db ?? DEFAULT_WATER_DB
  switch (p.flag) {
    case "decrease":
      return `Darker: ${down}${post < water ? ", now at open-water level" : ""}`
    case "increase":
      return event.cross_pol
        ? `Brighter, HH rose more than HV: double bounce, ${doubleBounce(event.hazard)}`
        : `Brighter: ${up}`
    case "volume":
      return "Brighter in HH and HV alike: vegetation growth or a rougher surface"
    case "rough_water":
      return "Brighter but still water-dark: wind-roughened water"
    default:
      return post < water
        ? "Water-dark on the after date, no significant change"
        : "No significant change"
  }
}

export interface ColourMeaning {
  /** Tailwind class of the swatch, or null where the map shows no change colour. */
  swatch: string | null
  name: string
  meaning: string
}

/** What the colour under the cursor means, in words. */
export function colourMeaning(flag: ChangeClass | null, event: SarEvent): ColourMeaning {
  switch (flag) {
    case "decrease":
      return {
        swatch: CLASS_SWATCH.decrease,
        name: "Blue",
        meaning: "The ground turned darker to the radar: its surface became smoother or wetter.",
      }
    case "increase":
      return {
        swatch: CLASS_SWATCH.increase,
        name: "Magenta",
        meaning: event.cross_pol
          ? "Brighter, mostly in HH: the signal now bounces off something upright (walls, trunks, blocks)."
          : "The ground turned brighter: something rougher or upright is there now.",
      }
    case "volume":
      return {
        swatch: CLASS_SWATCH.volume,
        name: "Orange",
        meaning: "Brighter in HH and HV alike: a rougher surface, debris, or more vegetation.",
      }
    case "rough_water":
      return {
        swatch: CLASS_SWATCH.rough_water,
        name: "Pale teal",
        meaning: "Water ruffled by wind. Shown, but not counted as change.",
      }
    default:
      return {
        swatch: null,
        name: "No colour",
        meaning: `Changed by less than ±${event.threshold_db} dB, so it counts as unchanged.`,
      }
  }
}

/** Typical L-band HH levels after speckle filtering: below DARK is smooth ground, above BRIGHT
 * is canopy, structures or rough rock. Rough guides for the words, not class boundaries. */
const LEVEL_DARK_DB = -12
const LEVEL_BRIGHT_DB = -6

/** Ground class of one date's level: the same rule as sars-backend ground.py, so the hover card
 * names the colour the Ground view paints there. */
export function groundClassOf(db: number, event: SarEvent): GroundClass {
  if (db < (event.stats.water_line_db ?? DEFAULT_WATER_DB)) return "water"
  if (db < LEVEL_DARK_DB) return "smooth"
  if (db < LEVEL_BRIGHT_DB) return "medium"
  return "bright"
}

/** Ground classes of both dates, as the Before & after view paints them: the after date differs
 * from the before date only where the change layer measured a real change; a small shift that
 * crosses a class line, or wind on water, keeps the before class. Mirrors ground.ground_pair. */
export function groundPairOf(
  pre: number,
  post: number,
  flag: Probe["flag"],
  event: SarEvent
): [GroundClass, GroundClass] {
  const a = groundClassOf(pre, event)
  const changed = flag != null && flag !== "rough_water"
  return [a, changed ? groundClassOf(post, event) : a]
}

/** Swatch and short name of each ground class (colours: --ground-* in index.css). */
export const GROUND_SWATCH: Record<GroundClass, string> = {
  water: "bg-ground-water",
  smooth: "bg-ground-smooth",
  medium: "bg-ground-medium",
  bright: "bg-ground-bright",
}
export const GROUND_LABEL: Record<GroundClass, string> = {
  water: "Water",
  smooth: "Smooth ground",
  medium: "Fields & shrubs",
  bright: "Bright",
}

const GROUND_WORDS: Record<GroundClass, string> = {
  water: "very dark: open water or very smooth ground",
  smooth: "dark: smooth ground, bare soil, mud or short grass",
  medium: "medium: fields, shrubs or open woodland",
  bright: "bright: forest, buildings, boulders or slopes facing the satellite",
}

/** How one date looked to the radar, in words. */
export function levelWords(db: number, event: SarEvent): string {
  return GROUND_WORDS[groundClassOf(db, event)]
}

/** Below this the two dates return practically the same signal. */
const SAME_SIGNAL_DB = 1

/** A change in dB as a share of the signal: -9 dB -> "13% of the signal it returned before". */
export function signalRatio(deltaDb: number): string {
  if (Math.abs(deltaDb) < SAME_SIGNAL_DB) return "practically the same signal as before"
  const factor = 10 ** (deltaDb / 10)
  if (factor < 1) return `${Math.round(factor * 100)}% of the signal it returned before`
  return `${factor < 10 ? factor.toFixed(1) : Math.round(factor)}× the signal it returned before`
}

/** Even-odd test over every ring of an area (holes included), rings as [lat, lon] pairs. */
function insideRings(rings: [number, number][][], lat: number, lon: number): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i]
      const [yj, xj] = ring[j]
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** The numbered area of concentrated change that holds this point, if any. */
export function regionAt(regions: Region[], lat: number, lon: number): Region | undefined {
  return regions.find((r) => r.rings?.length && insideRings(r.rings, lat, lon))
}
