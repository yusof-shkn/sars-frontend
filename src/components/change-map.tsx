import "leaflet/dist/leaflet.css"
import { divIcon, Util, type Map as LeafletMap, type TileErrorEvent } from "leaflet"
import * as React from "react"
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Rectangle,
  ScaleControl,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet"

import type { HoverPoint, MapView } from "@/components/hover-reading"
import { API_URL, fileUrl, type Region, type SarEvent, type Story } from "@/lib/api"
import { pointLetter } from "@/lib/story"

/** Area outlines as map lines (sharp at every zoom): a light halo under a dark line so they read
 * over radar, photos and change colours alike. They sit in their own unclipped pane, so the same
 * area shows on both sides of the divider. */
function AreaOutlines({ regions }: { regions: Region[] }) {
  return regions.flatMap((r) =>
    r.rings?.length
      ? [
          <Polygon
            key={`halo-${r.n}`}
            pane="areas"
            positions={r.rings}
            interactive={false}
            pathOptions={{ color: "#ffffff", weight: 4.5, opacity: 0.85, fill: false }}
          />,
          <Polygon
            key={`line-${r.n}`}
            pane="areas"
            positions={r.rings}
            interactive={false}
            pathOptions={{ color: "#0f2533", weight: 1.75, opacity: 1, fill: false }}
          />,
        ]
      : []
  )
}

/** Numbered badges on the areas of concentrated change; a click reads that pixel and zooms in. */
function RegionMarkers({ regions, onPick }: { regions: Region[]; onPick: (r: Region) => void }) {
  return regions.map((r) => (
    <Marker
      key={r.n}
      position={[r.lat, r.lon]}
      // Badge sits above the spot with a pointer down to it, so it never covers what it marks.
      icon={divIcon({
        className: "region-badge",
        html: String(r.n),
        iconSize: [24, 24],
        iconAnchor: [12, 34],
      })}
      eventHandlers={{ click: () => onPick(r) }}
    />
  ))
}

/** The story on the map: its path as a dashed line and one lettered pin per place (letters, so
 * they are not taken for the numbered areas). Drawn in the unclipped pane, on both dates. */
function StoryLayer({
  story,
  regions,
  selected,
  onPick,
}: {
  story: Story
  regions: Region[]
  selected: number | null
  onPick: (i: number) => void
}) {
  const step = selected == null ? null : story.points[selected]
  const area = step?.area == null ? null : regions.find((r) => r.n === step.area)
  return (
    <>
      {/* The step's area, outlined so the eye lands on it. */}
      {area?.rings?.length && (
        <>
          <Polygon
            pane="areas"
            positions={area.rings}
            interactive={false}
            pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.9, fill: false }}
          />
          <Polygon
            pane="areas"
            positions={area.rings}
            interactive={false}
            pathOptions={{ color: "#c2410c", weight: 4, fillColor: "#c2410c", fillOpacity: 0.08 }}
          />
        </>
      )}
      {story.path && (
        <>
          <Polyline
            pane="areas"
            positions={story.path.points}
            interactive={false}
            pathOptions={{ color: "#ffffff", weight: 6, opacity: 0.8 }}
          />
          <Polyline
            pane="areas"
            positions={story.path.points}
            interactive={false}
            pathOptions={{ color: "#c2410c", weight: 2.5, dashArray: "8 6" }}
          />
        </>
      )}
      {/* Pins only while the story is being told, and only for steps about one place. */}
      {story.points.map(
        (p, i) =>
          i === selected &&
          p.area == null &&
          p.zoom >= 11 && (
            <Marker
              key={p.id}
              position={[p.lat, p.lon]}
              title={p.title}
              zIndexOffset={i === selected ? 2000 : 1000}
              icon={divIcon({
                className: i === selected ? "story-pin story-pin-on" : "story-pin",
                html: pointLetter(i),
                iconSize: [28, 28],
                iconAnchor: [14, 38],
              })}
              eventHandlers={{ click: () => onPick(i) }}
            />
          )
      )}
    </>
  )
}

/** Where the backend keeps its copy of a dated NASA layer (`pipeline tiles`). */
const localTiles = (layer: string, date: string, ext: string) =>
  `${API_URL}/files/tiles/${layer}/${date}/{z}/{y}/{x}.${ext}`

/**
 * Basemaps that need no API key. Static ones are one undated mosaic. Dated ones (NASA GIBS) take
 * a day: the map then shows the before-date imagery left of the divider and the after-date
 * imagery right of it, like the radar. `url` gets the theme, the date and the GIBS layer id;
 * `local` is the backend's copy of the same tiles, tried first.
 */
export const BASEMAPS = {
  gray: {
    label: "Gray",
    dated: false,
    // Esri's gray canvas: quiet enough that the radar is the loudest thing on the map.
    url: (dark: boolean) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    attribution: "Basemap &copy; Esri",
    maxNativeZoom: 16,
    className: "basemap-gray",
  },
  satellite: {
    label: "Satellite (undated)",
    dated: false,
    url: () =>
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxNativeZoom: 18,
    className: "",
  },
  streets: {
    label: "Streets",
    dated: false,
    url: () => "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    className: "",
  },
  hls: {
    label: "HLS 30 m, both dates",
    dated: true,
    // Harmonized Landsat + Sentinel-2 true colour: a scene every 2-3 days, cloud permitting.
    url: (_dark: boolean, date: string, layer = "HLS_S30_Nadir_BRDF_Adjusted_Reflectance") =>
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`,
    local: (date: string, layer = "HLS_S30_Nadir_BRDF_Adjusted_Reflectance") =>
      localTiles(layer, date, "png"),
    attribution: "NASA GIBS &middot; HLS (Landsat 8/9, Sentinel-2)",
    maxNativeZoom: 12,
    className: "",
  },
  modis: {
    label: "MODIS 250 m, both dates",
    dated: true,
    // Daily, coarse, clouds and all. Not radar.
    url: (_dark: boolean, date: string) =>
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    local: (date: string) => localTiles("MODIS_Terra_CorrectedReflectance_TrueColor", date, "jpg"),
    attribution: "NASA GIBS &middot; MODIS Terra",
    maxNativeZoom: 9,
    className: "",
  },
} as const
export type Basemap = keyof typeof BASEMAPS
/** Common shape of a BASEMAPS entry, so a chosen one can be called with the full argument list. */
export type BasemapDef = {
  label: string
  dated: boolean
  url: (dark: boolean, date: string, layer?: string) => string
  local?: (date: string, layer?: string) => string
  attribution: string
  maxNativeZoom: number
  className: string
}

/** The imagery date each side of the swipe shows for a dated basemap. */
export function opticalDates(event: SarEvent, basemap: Basemap) {
  const radar = [event.pre.datetime.slice(0, 10), event.post.datetime.slice(0, 10)]
  if (basemap === "hls") {
    return (event.hls ?? [null, null]).map((h) => h && { date: h.date, layer: h.layer })
  }
  if (basemap === "modis") return radar.map((date) => ({ date, layer: undefined }))
  return [null, null]
}

/** Diameter of the swipe handle, px. */
export const SWIPE_HANDLE = 40

/** One date of a NASA layer, read from the backend's copy first. GIBS serves its tiles with
 * no-store, so without that copy every view would refetch them; a tile outside the copy comes
 * from GIBS directly. */
function DatedTiles({
  base,
  dark,
  opt,
  pane,
}: {
  base: BasemapDef
  dark: boolean
  opt: { date: string; layer?: string }
  pane: string
}) {
  const remote = base.url(dark, opt.date, opt.layer)
  return (
    <TileLayer
      pane={pane}
      url={base.local ? base.local(opt.date, opt.layer) : remote}
      maxNativeZoom={base.maxNativeZoom}
      maxZoom={19}
      eventHandlers={{
        tileerror: (e: TileErrorEvent) => {
          const img = e.tile as HTMLImageElement
          if (img.dataset.remote) return
          img.dataset.remote = "1"
          img.src = Util.template(remote, e.coords)
        },
      }}
    />
  )
}

/** Divider x for a split in 0..1 of the map's full width: [HANDLE/2, width - HANDLE/2]. The split
 * never depends on the sidebar, so opening or closing it leaves the divider where it was. */
export const swipeX = (split: number, width: number) =>
  SWIPE_HANDLE / 2 + split * Math.max(0, width - SWIPE_HANDLE)

/** Where the map may place content: clear of the story panel on the left, the top bar and the
 * toolbar. Used for the first fit, the Fit button and zooming to an area. */
export type FitOptions = {
  paddingTopLeft: [number, number]
  paddingBottomRight: [number, number]
}

/** Hands the Leaflet map instance to the parent so toolbar buttons can zoom / fit. */
function MapBridge({
  onMap,
  bounds,
  fit,
}: {
  onMap: (map: LeafletMap) => void
  bounds: SarEvent["bounds"]
  fit: FitOptions
}) {
  const map = useMap()
  React.useEffect(() => onMap(map), [map, onMap])
  // Fit after layout has settled: the initial `bounds` prop can be applied before the container
  // has its final size (seen when switching events), leaving the scene off-screen.
  const key = bounds.flat().join(",")
  React.useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize()
      map.fitBounds(bounds, fit)
    }, 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/**
 * Before/after swipe without a plugin. The "before" image gets its own pane stacked above the
 * overlay pane; that pane is clipped to the left of the divider and the overlay pane (after +
 * change mask) to the right. `clip` works in pane coordinates, which move with the map, so the
 * rectangles are recomputed on every move/zoom.
 */
function Swipe({ divider }: { divider: number }) {
  const map = useMap()

  // Layout effect so the panes exist before sibling layers are added (those run in effects).
  // Radar "before" sits above the overlay pane; dated imagery gets two panes above the basemap.
  React.useLayoutEffect(() => {
    if (!map.getPane("before")) map.createPane("before").style.zIndex = "450"
    if (!map.getPane("tilesBefore")) map.createPane("tilesBefore").style.zIndex = "250"
    if (!map.getPane("tilesAfter")) map.createPane("tilesAfter").style.zIndex = "260"
    // Area outlines: above both radar images and never clipped, so the same area can be
    // compared on either side of the divider.
    if (!map.getPane("areas")) map.createPane("areas").style.zIndex = "460"
  }, [map])

  const update = React.useCallback(() => {
    const size = map.getSize()
    const nw = map.containerPointToLayerPoint([0, 0])
    const se = map.containerPointToLayerPoint([size.x, size.y])
    const x = map.containerPointToLayerPoint([divider, 0]).x
    // Each side shows only its own date (radar and dated imagery alike), so the opacity slider
    // reveals the basemap underneath rather than the other date bleeding through.
    const left = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`
    const right = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`
    for (const [pane, clip] of [
      ["before", left],
      ["tilesBefore", left],
      ["overlayPane", right], // after image + change mask live here
      ["tilesAfter", right],
    ] as const) {
      const el = map.getPane(pane)
      if (el) el.style.clip = clip
    }
  }, [map, divider])

  useMapEvents({ move: update, zoom: update, resize: update })
  React.useEffect(update, [update])
  return null
}

/** A click anywhere on the map reads that pixel; the marker shows where. */
function Probe({
  point,
  onPick,
}: {
  point: { lat: number; lon: number } | null
  onPick: (lat: number, lon: number) => void
}) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  if (!point) return null
  return (
    <CircleMarker
      center={[point.lat, point.lon]}
      radius={7}
      pathOptions={{ color: "var(--primary)", weight: 2, fillColor: "var(--card)", fillOpacity: 1 }}
      interactive={false}
    />
  )
}

/** Reports the spot under the mouse; nothing while the map is dragged or zoomed. */
function HoverTracker({ onHover }: { onHover: (point: HoverPoint | null) => void }) {
  const dragging = React.useRef(false)
  useMapEvents({
    mousemove: (e) => {
      if (dragging.current) return
      onHover({
        lat: e.latlng.lat,
        lon: e.latlng.lng,
        x: e.containerPoint.x,
        y: e.containerPoint.y,
      })
    },
    mouseout: () => onHover(null),
    click: () => onHover(null),
    zoomstart: () => onHover(null),
    dragstart: () => {
      dragging.current = true
      onHover(null)
    },
    dragend: () => {
      dragging.current = false
    },
  })
  return null
}

/**
 * Full-bleed map for one event. Left of the divider: before. Right: after, with the change mask
 * on top when enabled, so the viewer always sees what the radar saw underneath.
 */
export function ChangeMap({
  event,
  showChange,
  showAreas,
  opacity,
  dark,
  basemap,
  onMap,
  probe,
  onProbe,
  colour,
  subtle,
  onRegion,
  fit,
  divider,
  onHover,
  view,
  storyIndex,
  onStoryPoint,
}: {
  event: SarEvent
  showChange: boolean
  /** The numbered areas of concentrated change: outlines and badges. */
  showAreas: boolean
  opacity: number
  dark: boolean
  basemap: Basemap
  onMap: (map: LeafletMap) => void
  probe: { lat: number; lon: number } | null
  onProbe: (lat: number, lon: number) => void
  /** Dual-pol false colour instead of grayscale backscatter (when the event has it). */
  colour: boolean
  /** Landscape-scale (~500 m) coherent-change overlay instead of the pixel mask. */
  subtle: boolean
  onRegion: (r: Region) => void
  fit: FitOptions
  /** Divider x in px from the map's left edge (the page computes it, knob and chips use it too). */
  divider: number
  /** The spot under the mouse, for the hover explanation. */
  onHover: (point: HoverPoint | null) => void
  /** "ground": both dates coloured by ground class; "change": radar + change on the after side. */
  view: MapView
  /** Selected story place (null: overview), and what a click on a story pin does. */
  storyIndex: number | null
  onStoryPoint: (i: number) => void
}) {
  const base: BasemapDef = BASEMAPS[basemap]
  const ground = view === "ground" && !!event.layers.before_ground && !!event.layers.after_ground
  const before =
    (ground && event.layers.before_ground) ||
    (colour && event.layers.before_rgb) ||
    event.layers.before
  const after =
    (ground && event.layers.after_ground) ||
    (colour && event.layers.after_rgb) ||
    event.layers.after
  const [optPre, optPost] = opticalDates(event, basemap)
  // For a dated basemap the gray canvas stays underneath to fill days without a scene.
  const under: BasemapDef = base.dated ? BASEMAPS.gray : base
  return (
    <MapContainer
      // New event -> new map, so it fits the new bounds.
      key={event.id}
      bounds={event.bounds}
      boundsOptions={fit}
      // Fractional zoom so the radar image fills the frame instead of snapping a level smaller.
      zoomSnap={0.25}
      zoomControl={false}
      // Credits live in the details drawer instead of a strip over the map.
      attributionControl={false}
      className="absolute inset-0"
    >
      <TileLayer
        key={`${base.dated ? "gray" : basemap}-${dark}`}
        url={under.url(dark, "")}
        attribution={`${base.attribution} · Radar: NASA/ISRO NISAR via ASF DAAC`}
        maxNativeZoom={under.maxNativeZoom}
        maxZoom={19}
        className={under.className}
      />
      {base.dated && optPre && (
        <DatedTiles
          key={`pre-${basemap}-${optPre.date}`}
          base={base}
          dark={dark}
          opt={optPre}
          pane="tilesBefore"
        />
      )}
      {base.dated && optPost && (
        <DatedTiles
          key={`post-${basemap}-${optPost.date}`}
          base={base}
          dark={dark}
          opt={optPost}
          pane="tilesAfter"
        />
      )}
      <MapBridge onMap={onMap} bounds={event.bounds} fit={fit} />
      <Swipe divider={divider} />
      <ImageOverlay url={fileUrl(after)} bounds={event.bounds} opacity={opacity} />
      {showChange && !ground && (
        <ImageOverlay url={fileUrl(event.layers.change)} bounds={event.bounds} zIndex={10} />
      )}
      {subtle && !ground && event.layers.subtle && (
        <ImageOverlay url={fileUrl(event.layers.subtle)} bounds={event.bounds} zIndex={9} />
      )}
      <ImageOverlay url={fileUrl(before)} bounds={event.bounds} opacity={opacity} pane="before" />
      {/* The analysed box, so its hard edges read as a boundary, not a rendering glitch. */}
      <Rectangle
        bounds={event.bounds}
        interactive={false}
        pathOptions={{
          color: "var(--primary)",
          weight: 1,
          dashArray: "4 4",
          fill: false,
          opacity: 0.6,
        }}
      />
      <Probe point={probe} onPick={onProbe} />
      <HoverTracker onHover={onHover} />
      {showAreas && <AreaOutlines regions={event.regions} />}
      {showAreas && <RegionMarkers regions={event.regions} onPick={onRegion} />}
      {event.story && (
        <StoryLayer
          story={event.story}
          regions={event.regions}
          selected={storyIndex}
          onPick={onStoryPoint}
        />
      )}
      <ScaleControl position="bottomright" imperial={false} />
    </MapContainer>
  )
}
