/** One honest sentence on what the radar shows at a story point. If it shows nothing, say so and
 * say why, rather than letting the story imply a signal the data does not hold. */
import type { SarEvent, StoryPoint } from "@/lib/api"
import { readsAs } from "@/lib/reading"

/** Below this share of changed ground within 300 m, the radar shows no clear change there. */
const CLEAR_CHANGE_PCT = 1

/** Why a real event can leave no mark in this radar pair, per hazard. */
const WHY_NOTHING: Record<string, string> = {
  landslide:
    "The flow followed a channel only tens of metres wide, about the size of one radar pixel, and steep valley walls hide parts of the valley floor from the satellite.",
  glacier:
    "Steep rock and ice faces are partly hidden from the satellite, and snow can look the same before and after.",
  earthquake:
    "Shaking and cracks do not change how rough or wet the ground is; only large landslides or widespread collapse show in this kind of radar image.",
  farmland: "Low crops are nearly transparent to this long-wavelength radar.",
}
const WHY_DEFAULT = "The change here was smaller than the radar's noise, or smaller than one pixel."

export const pointLetter = (i: number) => String.fromCharCode(65 + i)

export function radarSentence(point: StoryPoint, event: SarEvent): string {
  const r = point.radar
  if (!r || !r.covered) {
    return "The radar has no measurement at this spot in this event: it lies outside the analysed area, or the terrain hides it from the satellite."
  }
  const pct = r.changed_pct_300m ?? 0
  if (pct < CLEAR_CHANGE_PCT) {
    return `The radar shows no clear change within 300 m of this spot (${r.pre_db} dB before, ${r.post_db} dB after). ${WHY_NOTHING[event.hazard] ?? WHY_DEFAULT} What happened here is known from reports on the ground, not from this image.`
  }
  const here =
    r.flag && r.pre_db != null && r.post_db != null
      ? ` At the pin itself: ${readsAs({ lat: point.lat, lon: point.lon, ...r }, event).toLowerCase()}.`
      : " The pin itself sits on unchanged ground; the change is around it."
  return `The radar measured a clear change on ${pct}% of the ground within 300 m of this spot.${here} Switch to "Only changes" to see exactly where.`
}
