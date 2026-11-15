/** Everyday words for an event: what happened, how much, and what it most likely means, for
 * people who have never read a radar image. The technical version stays in the sidebar's
 * "Technical details" section. */
import { daysBetween, formatDate, type GroundClass, type SarEvent } from "@/lib/api"
import { GROUND_LABEL, wording } from "@/lib/reading"

/** A football pitch is about 105 x 68 m. */
const PITCH_KM2 = 0.00714
/** Above this a pitch count stops helping; plain km² reads better. */
const PITCH_MAX_KM2 = 50
/** Below this share of the scene, change can as easily be rain, wind or season. */
const SMALL_CHANGE_PCT = 1
/** Smallest area worth a sentence. */
const MENTION_KM2 = 0.1

const round = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 1 : 0 })

/** "22 km² (about 3,100 football pitches)". */
export function friendlyArea(km2: number): string {
  const base = `${round(km2)} km²`
  if (km2 >= PITCH_MAX_KM2 || km2 < PITCH_KM2) return base
  const pitches = Math.round(km2 / PITCH_KM2 / (km2 < 1 ? 10 : 100)) * (km2 < 1 ? 10 : 100)
  return `${base} (about ${pitches.toLocaleString()} football pitches)`
}

/** "Two satellite pictures, 12 days apart: 19 Aug 2026 and 31 Aug 2026." */
export function plainDates(e: SarEvent): string {
  const days = daysBetween(e.pre.datetime, e.post.datetime)
  return `Two satellite pictures, ${days} days apart: ${formatDate(e.pre.datetime)} and ${formatDate(e.post.datetime)}.`
}

/** The ground class whose area moved most between the dates, if it moved noticeably. */
function biggestShift(e: SarEvent): string | null {
  const g = e.stats.ground
  if (!g) return null
  const [cls, v] = (Object.entries(g) as [GroundClass, { before_km2: number; after_km2: number }][])
    .map(([k, a]) => [k, a] as const)
    .sort(
      (a, b) =>
        Math.abs(b[1].after_km2 - b[1].before_km2) - Math.abs(a[1].after_km2 - a[1].before_km2)
    )[0]
  const delta = v.after_km2 - v.before_km2
  if (Math.abs(delta) < 1) return null
  return `The biggest shift: "${GROUND_LABEL[cls]}" went from ${round(v.before_km2)} to ${round(v.after_km2)} km² (${delta > 0 ? "more" : "less"} by ${round(Math.abs(delta))} km²).`
}

/** What happened, in a few short sentences. */
export function plainSummary(e: SarEvent): string[] {
  const s = e.stats
  const [down, up] = wording(e.hazard)
  const out: string[] = [`The satellite looked at the same ${friendlyArea(s.aoi_km2)} twice.`]
  const wind = s.increase_rough_water_km2 ?? 0
  const brighter = Math.max(0, s.increase_km2 - wind)

  if (s.changed_pct < 0.5 && brighter < 1 && s.decrease_km2 < 1) {
    out.push("Almost nothing changed clearly between the two pictures.")
  } else {
    out.push(`About ${round(s.changed_pct)}% of it looks clearly different in the second picture.`)
  }
  if (s.open_water_km2 >= MENTION_KM2) {
    out.push(`About ${friendlyArea(s.open_water_km2)} of land turned into water.`)
  }
  if (s.decrease_km2 >= MENTION_KM2) {
    out.push(`${friendlyArea(s.decrease_km2)} got darker. Most likely: ${down}.`)
  }
  if (brighter >= MENTION_KM2) {
    // Wind on water has its own sentence below when the mode can tell it apart.
    const likely = e.cross_pol ? up.replace(/,? or wind on water$/, "") : up
    out.push(`${friendlyArea(brighter)} got brighter. Most likely: ${likely}.`)
  }
  if (wind >= 1) {
    out.push(
      `Wind ruffled ${round(wind)} km² of water on the second date. That is not counted as change.`
    )
  }
  const shift = biggestShift(e)
  if (shift) out.push(shift)
  out.push(
    e.regions.length
      ? `${e.regions.length === 1 ? "One place stands" : `${e.regions.length} places stand`} out where the change is packed together; ${e.regions.length === 1 ? "it is" : "they are"} numbered on the map, 1 being the biggest.`
      : "No single place stands out: the change is scattered thinly."
  )
  if (s.changed_pct < SMALL_CHANGE_PCT) {
    out.push(
      "Changes this small can also come from rain, wind or the season, so treat them as a hint, not proof."
    )
  }
  return out
}

/** How to read the map, in four lines. */
export function howToRead(e: SarEvent): string[] {
  return [
    `Left of the round handle is ${formatDate(e.pre.datetime)}; right of it is ${formatDate(e.post.datetime)}. Drag the handle to compare.`,
    '"Before & after" paints what the land looked like on each date: water, bare ground, fields, and bright things like forest, buildings and rock.',
    '"Only changes" paints just the spots that changed. Click any colour in the bar at the bottom to learn what it means.',
    "Rest your mouse on any spot (or tap it) to read what happened there.",
  ]
}
