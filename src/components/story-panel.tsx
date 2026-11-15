import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, XIcon } from "lucide-react"
import * as React from "react"

import { fileUrl, formatDate, type SarEvent, type Story, type StoryPoint } from "@/lib/api"
import { radarSentence } from "@/lib/story"
import { cn } from "@/lib/utils"

const navBtn =
  "flex h-10 items-center gap-1.5 rounded-lg px-4 text-[14px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"

/** The id of a YouTube watch / share link, for its thumbnail; null for any other site. */
function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([\w-]{11})/)
  return m ? m[1] : null
}

/** A video about the event: its thumbnail with a play mark, opening the video in a new tab. */
function VideoLink({ title, url }: { title: string; url: string }) {
  const id = youtubeId(url)
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group relative block overflow-hidden rounded-lg border border-foreground/10 bg-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {id && (
        <img
          src={`https://img.youtube.com/vi/${id}/hqdefault.jpg`}
          alt=""
          className="aspect-video w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
        />
      )}
      <span
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-white",
          id && "absolute inset-x-0 bottom-0 bg-black/65"
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#c2410c]">
          <PlayIcon className="size-3 fill-current" />
        </span>
        {title}
        <span className="ml-auto text-[11px] font-normal opacity-80">opens YouTube</span>
      </span>
    </a>
  )
}

type Box = [[number, number], [number, number]]

/** One of the event's own map images, cropped to a box: a "map picture" of the place. */
function Crop({ layers, event, box }: { layers: string[]; event: SarEvent; box: Box }) {
  const [[south, west], [north, east]] = event.bounds
  const [[bs, bw], [bn, be]] = box
  const style: React.CSSProperties = {
    position: "absolute",
    width: `${((east - west) / (be - bw)) * 100}%`,
    height: `${((north - south) / (bn - bs)) * 100}%`,
    left: `${(-(bw - west) / (be - bw)) * 100}%`,
    top: `${(-(north - bn) / (bn - bs)) * 100}%`,
    maxWidth: "none",
    imageRendering: "pixelated",
  }
  return (
    <>
      {layers.map((l) => (
        <img key={l} src={fileUrl(l)} alt="" style={style} />
      ))}
    </>
  )
}

/** The radar's own before and after of the step's place, side by side: gray radar before, and
 * after with the change colours on top, so the difference is the coloured part. */
function RadarPair({ point, event }: { point: StoryPoint; event: SarEvent }) {
  const region = point.area == null ? null : event.regions.find((r) => r.n === point.area)
  const d = 0.02
  const raw: Box = region?.box ?? [
    [point.lat - d, point.lon - d],
    [point.lat + d, point.lon + d],
  ]
  // Square on the ground (a degree of longitude is shorter than one of latitude), a little margin.
  const k = Math.cos((point.lat * Math.PI) / 180)
  const half = Math.max(raw[1][0] - raw[0][0], (raw[1][1] - raw[0][1]) * k) * 0.55
  const cy = (raw[0][0] + raw[1][0]) / 2
  const cx = (raw[0][1] + raw[1][1]) / 2
  const box: Box = [
    [cy - half, cx - half / k],
    [cy + half, cx + half / k],
  ]
  const sides: [string, string, string[]][] = [
    ["Before", event.pre.datetime, [event.layers.before]],
    ["After", event.post.datetime, [event.layers.after, event.layers.change]],
  ]
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {sides.map(([name, date, layers]) => (
        <figure
          key={name}
          className="relative aspect-square overflow-hidden rounded-lg bg-neutral-800"
        >
          <Crop layers={layers} event={event} box={box} />
          <figcaption className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            {name} · {formatDate(date)}
          </figcaption>
        </figure>
      ))}
      <p className="col-span-2 text-[11px] text-muted-foreground">
        The radar's own pictures of this place. Colour on the right marks what changed.
      </p>
    </div>
  )
}

/**
 * The event as a guided tour, in a card over the map. `index` null is the opening card (what
 * happened, and a Start button); a number is one step: the map has already flown there and
 * switched to the layers the step needs.
 */
export function StoryCard({
  story,
  event,
  index,
  onIndex,
  onClose,
}: {
  story: Story
  event: SarEvent
  index: number | null
  onIndex: (i: number | null) => void
  onClose: () => void
}) {
  const point = index == null ? null : story.points[index]
  const last = story.points.length - 1
  const scroller = React.useRef<HTMLDivElement>(null)
  // A step about the whole scene has no single spot to measure.
  const isPlace = !!point && (point.area != null || point.zoom >= 11)
  React.useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [index])
  return (
    <section
      data-testid="story"
      aria-label="The story of this event"
      className="pointer-events-auto absolute top-14 right-3 z-20 flex max-h-[calc(100svh-15rem)] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xl max-md:max-h-[46svh]"
    >
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#c2410c] px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-white uppercase">
            The story
          </span>
          {point && (
            <span
              className="flex items-center gap-1"
              aria-label={`Step ${index! + 1} of ${story.points.length}`}
            >
              {story.points.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`Go to step ${i + 1}: ${p.title}`}
                  onClick={() => onIndex(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === index
                      ? "w-6 bg-[#c2410c]"
                      : "w-2.5 bg-foreground/20 hover:bg-foreground/40"
                  )}
                />
              ))}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the story"
            className="-mr-2 ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {!point ? (
          <>
            <h2 className="text-2xl leading-tight font-bold tracking-tight text-balance">
              {event.title}
            </h2>
            <p className="text-[15px] leading-relaxed">{story.summary}</p>
            <button
              type="button"
              onClick={() => onIndex(0)}
              className={cn(
                navBtn,
                "h-12 justify-center bg-[#c2410c] text-[15px] text-white hover:bg-[#9a3412]"
              )}
            >
              <PlayIcon className="size-4 fill-current" /> Show me, step by step
            </button>
            <p className="text-xs text-muted-foreground">
              {story.points.length} steps. The map moves and changes by itself as you go.
            </p>
          </>
        ) : (
          <>
            {point.headline && (
              <p
                className="text-[22px] leading-tight font-bold tracking-tight text-balance text-[#c2410c]"
                data-testid="story-headline"
              >
                {point.headline}
              </p>
            )}
            <h3 className="text-[15px] leading-snug font-semibold" data-testid="story-title">
              {point.title}
            </h3>
            {point.photos.map((ph) => (
              <figure key={ph.file} className="flex flex-col gap-1">
                <img
                  src={fileUrl(ph.file)}
                  alt={ph.caption}
                  className="w-full rounded-lg border border-foreground/10"
                />
                <figcaption className="text-xs leading-snug text-muted-foreground">
                  {ph.caption}{" "}
                  <a
                    href={ph.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    Photo: {ph.credit}, {ph.licence}
                  </a>
                </figcaption>
              </figure>
            ))}
            {isPlace && point.show?.radar_opacity !== 0 && (
              <RadarPair point={point} event={event} />
            )}
            <p className="text-[14px] leading-relaxed">{point.what_happened}</p>
            {point.videos?.map((v) => (
              <VideoLink key={v.url} title={v.title} url={v.url} />
            ))}
            {isPlace && point.show?.radar_opacity !== 0 && (
              <div className="rounded-lg bg-foreground/5 px-3 py-2.5">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Measured here by the radar
                </p>
                <p className="mt-1 text-[13px] leading-relaxed">{radarSentence(point, event)}</p>
              </div>
            )}
            {point.sources.length > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sources:{" "}
                {point.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 && " · "}
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {s.label}
                    </a>
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </div>
      {point && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-card px-5 py-3">
          <button
            type="button"
            onClick={() => onIndex(index === 0 ? null : index! - 1)}
            className={cn(navBtn, "border border-foreground/15 hover:bg-accent")}
          >
            <ChevronLeftIcon className="size-4" /> Back
          </button>
          {index === last ? (
            <button
              type="button"
              onClick={onClose}
              className={cn(navBtn, "bg-foreground text-background hover:opacity-90")}
            >
              Explore the map
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onIndex(index! + 1)}
              className={cn(navBtn, "bg-[#c2410c] text-white hover:bg-[#9a3412]")}
            >
              Next <ChevronRightIcon className="size-4" />
            </button>
          )}
        </div>
      )}
    </section>
  )
}
