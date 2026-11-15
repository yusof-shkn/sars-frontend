/** The colour key: every colour the map can draw, what it stands for, what it can mean for this
 * kind of event and what usually causes it, with this event's numbers. Plain words for people
 * who have never read a radar image. */
import type { GroundClass, SarEvent } from "@/lib/api"
import { CLASS_SWATCH, GROUND_LABEL, GROUND_SWATCH, type ChangeClass } from "@/lib/reading"

export interface KeyEntry {
  id: string
  swatch: string
  name: string
  /** One line under the name on the chip, e.g. "12.3 km²" or "300 → 313 km²". */
  figure: string | null
  /** What the colour stands for, independent of the event. */
  shows: string
  /** What it most plausibly means for this kind of event. */
  meaning: string
  /** What usually causes it. */
  causes: string[]
  /** The measured numbers, in a sentence. */
  measured: string | null
}

type ByHazard = Partial<Record<string, string>> & { default: string }

const pick = (table: ByHazard, hazard: string) => table[hazard] ?? table.default

const km2 = (v: number | null | undefined) =>
  v == null
    ? null
    : `${v < 0.01 && v > 0 ? "<0.01" : v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 1 : 0 })} km²`

/* ---------- change colours (after date only: they are a difference) ---------- */

const CHANGE: Record<
  ChangeClass,
  { name: string; shows: string; meaning: ByHazard; causes: ByHazard }
> = {
  decrease: {
    name: "Got darker",
    shows:
      "The radar signal dropped by more than the threshold. A smoother or wetter surface acts like a mirror and sends the radar away from the satellite, so it looks darker.",
    meaning: {
      flood: "New standing water or flooded fields.",
      fire: "Canopy burned away, leaving smoother ground.",
      landslide: "Fresh mud or fine debris smoothed the ground, or a river spread wider.",
      earthquake: "Liquefaction mud came up, or ground slid or was flattened.",
      glacier: "Snow or ice turned wet and melting, or meltwater pooled.",
      farmland: "Fields harvested or ploughed: the leafy crop is gone, bare soil remains.",
      lake: "Wet snow, melting ice, or the water spread.",
      default: "The surface became smoother or wetter.",
    },
    causes: {
      flood: "River overflow; heavy rain; water standing on fields",
      fire: "Leaves and branches burned; ash on bare soil",
      landslide: "Mudflow deposits; river avulsion; soaked soil",
      earthquake: "Liquefaction; ground cracking and settling; landslides on slopes",
      glacier: "Warm weather melting the surface; meltwater; wet snow",
      farmland: "Harvest; ploughing; fields left bare between crops",
      lake: "Snowmelt; rising lake level; thawing ice",
      default: "Water; mud; melting snow; cleared vegetation",
    },
  },
  increase: {
    name: "Double bounce",
    shows:
      "Brighter, with HH rising more than HV. The radar hit an upright surface and then the ground (or water) and came straight back, like a ball off a corner.",
    meaning: {
      flood: "Water lying under trees or around buildings.",
      fire: "Burnt trunks standing over bare ground.",
      landslide: "Boulders, wreckage or damaged buildings in the flow path.",
      earthquake: "Collapsed or tilted buildings, or heaps of rubble.",
      glacier: "Blocks of ice, crevasse walls or seracs.",
      farmland: "Tall crop stems standing in wet or irrigated soil.",
      lake: "Blocks of rock or ice edges.",
      default: "New upright surfaces: walls, trunks or blocks.",
    },
    causes: {
      flood: "Flooded forest or crops; water in streets",
      fire: "Trunks left standing after the canopy burned",
      landslide: "Boulders and debris piled against walls or trees",
      earthquake: "Building damage; rubble; tilted walls",
      glacier: "Ice breaking into blocks; crevassing",
      farmland: "Irrigation under tall crops; stalks left standing after harvest",
      default: "Corners formed by walls, trunks or blocks over a flat surface",
    },
  },
  volume: {
    name: "Rougher / growth",
    shows:
      "Brighter in both channels (HH and HV). A rough or leafy layer scatters the radar in all directions, so more of it comes back.",
    meaning: {
      flood: "Crops growing or soil getting wetter and rougher.",
      fire: "Rough burnt ground or regrowth.",
      landslide: "Rocky debris and rubble spread over the ground.",
      earthquake: "Landslide scars, debris and broken ground.",
      glacier: "Avalanche debris, broken ice or freshly exposed rock.",
      farmland: "Crops grew taller and leafier, or the soil got rougher.",
      lake: "Rockfall, frozen ground or dry snow over rough ground.",
      default: "A rougher surface or more vegetation.",
    },
    causes: {
      flood: "Crop growth between the dates; wet rough soil",
      fire: "Exposed rocks and logs; new shoots",
      landslide: "Boulder fields; rubble; scoured river beds",
      earthquake: "Landslides; rockfall; cracked ground",
      glacier: "Ice-rock avalanche deposits; rock walls laid bare",
      farmland: "Crop growth; ridged or clodded soil after ploughing",
      lake: "Autumn freeze; early snow; rockfall",
      default: "Rougher ground; denser vegetation",
    },
  },
  rough_water: {
    name: "Wind on water",
    shows:
      "Brighter, but still as dark as water. Wind ripples on the surface send a little of the radar back.",
    meaning: {
      default: "Wind on the day of the after image. Not a change in the ground: not counted.",
    },
    causes: { default: "Wind; waves; boat wakes" },
  },
}

function changeFigure(cls: ChangeClass, e: SarEvent): number | null {
  const s = e.stats
  if (cls === "decrease") return s.decrease_km2
  if (cls === "increase") return e.cross_pol ? s.increase_double_bounce_km2 : s.increase_km2
  if (cls === "volume") return s.increase_volume_km2
  return s.increase_rough_water_km2
}

/** Change colours with something to show in this event (rough water and the HV split only when
 * the mode has HV). */
export function changeKey(event: SarEvent): KeyEntry[] {
  const order: ChangeClass[] = event.cross_pol
    ? ["decrease", "increase", "volume", "rough_water"]
    : ["decrease", "increase"]
  return order.map((cls) => {
    const c = CHANGE[cls]
    const v = changeFigure(cls, event)
    const name = cls === "increase" && !event.cross_pol ? "Got brighter" : c.name
    return {
      id: cls,
      swatch: CLASS_SWATCH[cls],
      name,
      figure: km2(v),
      shows: c.shows,
      meaning: pick(c.meaning, event.hazard),
      causes: pick(c.causes, event.hazard).split("; "),
      measured:
        v == null
          ? null
          : `${km2(v)} of the ${km2(event.stats.aoi_km2)} scene, on the after side of the divider.`,
    }
  })
}

/* ---------- ground colours (both dates) ---------- */

const GROUND: Record<
  GroundClass,
  { shows: string; grew: ByHazard; shrank: ByHazard; causes: string[] }
> = {
  water: {
    shows:
      "Very dark to the radar: open water, or ground so smooth and wet that it acts like water.",
    grew: {
      flood: "More water: the flood spread over land.",
      landslide: "More water: a river spread, or a lake formed behind debris.",
      earthquake: "More water: liquefaction or flooding after the ground sank.",
      glacier: "More water: meltwater or a lake growing.",
      default: "More water than before.",
    },
    shrank: {
      flood: "Less water: the flood went down.",
      lake: "Less water-dark surface: wind, ice or snow on the lake, or the shore dried.",
      default: "Less water than before: it drained, froze or was roughened by wind.",
    },
    causes: ["Rivers, lakes, floods", "Very wet mud", "Calm water reflects the radar away"],
  },
  smooth: {
    shows: "Dark: bare soil, mud, sand, roads, short grass.",
    grew: {
      flood: "More bare or muddy ground: silt left behind, or soaked fields.",
      fire: "More bare ground where vegetation burned.",
      landslide: "More mud and bare ground: the debris flow covered fields and banks.",
      earthquake: "More bare ground: landslide scars or liquefaction mud.",
      glacier: "More smooth surface: wet snow or meltwater-soaked ice.",
      farmland: "More bare, smooth fields: crops harvested.",
      default: "More bare or smooth ground than before.",
    },
    shrank: { default: "Less bare ground: it got rougher, wetter or greener." },
    causes: ["Bare soil and mud", "Sand and silt", "Roads and short grass"],
  },
  medium: {
    shows: "Medium: fields, shrubs, open woodland, moderately rough ground.",
    grew: {
      farmland: "More fields with crops: they grew between the dates.",
      default: "More medium cover: vegetation grew, or rough ground was smoothed a little.",
    },
    shrank: {
      flood: "Fewer fields above water: flooded or turned to mud.",
      fire: "Fewer shrubs: burned.",
      landslide: "Fewer fields: buried by mud or swept away.",
      earthquake: "Fewer fields: covered by landslides or rubble.",
      farmland: "Fewer fields with crops: harvested or ploughed.",
      default: "Less of this cover than before.",
    },
    causes: ["Crops and grassland", "Shrubs", "Open woodland"],
  },
  bright: {
    shows: "Bright: forest, buildings, rock and rubble, and slopes that face the satellite.",
    grew: {
      fire: "More bright ground: burnt trunks standing over bare soil reflect strongly.",
      landslide: "More bright ground: boulders and rubble deposited.",
      earthquake: "More bright ground: rubble, debris or broken ground.",
      glacier: "More bright ground: avalanche debris, ice blocks or bare rock.",
      lake: "More bright ground: frost, rock or rough snow on the slopes.",
      default: "More bright, rough ground than before.",
    },
    shrank: {
      flood: "Less bright ground: trees or buildings now stand in water that hides them.",
      fire: "Less bright ground: canopy lost.",
      earthquake: "Less bright ground: buildings flattened.",
      default: "Less bright ground than before.",
    },
    causes: ["Forest", "Buildings", "Rock, rubble and steep slopes"],
  },
}

const GROUND_ORDER: GroundClass[] = ["water", "smooth", "medium", "bright"]

/** Below this the two dates hold practically the same area of a class. */
const SAME_AREA_KM2 = 0.5

/** Ground colours present in this event, with before → after areas. */
export function groundKey(event: SarEvent): KeyEntry[] {
  const g = event.stats.ground
  if (!g) return []
  return GROUND_ORDER.filter(
    (cls) => g[cls] && (g[cls].before_km2 > 0 || g[cls].after_km2 > 0)
  ).map((cls) => {
    const c = GROUND[cls]
    const { before_km2: b, after_km2: a } = g[cls]
    const delta = a - b
    const steady = Math.abs(delta) < SAME_AREA_KM2
    const pct = b > 0 ? Math.round((delta / b) * 100) : null
    return {
      id: cls,
      swatch: GROUND_SWATCH[cls],
      name: GROUND_LABEL[cls],
      figure: `${km2(b)} → ${km2(a)}`,
      shows: c.shows,
      meaning: steady
        ? "About the same area on both dates."
        : pick(delta > 0 ? c.grew : c.shrank, event.hazard),
      causes: c.causes,
      measured: `Before: ${km2(b)}. After: ${km2(a)}. ${
        steady
          ? "No real change."
          : `${delta > 0 ? "Grew" : "Shrank"} by ${km2(Math.abs(delta))}${pct != null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""}.`
      }`,
    }
  })
}
