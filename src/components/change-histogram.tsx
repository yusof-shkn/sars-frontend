import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import type { SarEvent } from "@/lib/api"

const config = { pixels: { label: "Pixels" } } satisfies ChartConfig

/**
 * How many pixels changed by how much. Bars past the threshold take the same colours as the
 * map mask; everything inside the threshold stays a quiet neutral.
 */
export function ChangeHistogram({ event }: { event: SarEvent }) {
  const t = event.threshold_db
  const fill = (db: number) =>
    db <= -t ? "var(--color-decrease)" : db >= t ? "var(--color-increase)" : "var(--color-chart-4)"

  return (
    <ChartContainer config={config} className="aspect-auto min-h-[240px] w-full flex-1">
      <BarChart
        data={event.stats.histogram}
        margin={{ left: 24, right: 24, top: 12, bottom: 0 }}
        barCategoryGap={2}
      >
        <CartesianGrid vertical={false} strokeDasharray="2 4" className="stroke-border" />
        <XAxis
          dataKey="db"
          type="number"
          domain={[-10, 10]}
          ticks={[-10, -5, 0, 5, 10]}
          interval={0}
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tick={{ fontSize: 11, fontFamily: "var(--font-sans)" }}
          tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v} dB`}
          className="fill-muted-foreground"
        />
        <YAxis hide scale="sqrt" />
        {[-t, t].map((x) => (
          <ReferenceLine key={x} x={x} strokeDasharray="3 3" className="stroke-muted-foreground" />
        ))}
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => {
                const db = Number(p?.[0]?.payload?.db)
                return `${db - 0.5} to ${db + 0.5} dB`
              }}
            />
          }
        />
        <Bar dataKey="pixels" radius={[3, 3, 0, 0]}>
          {event.stats.histogram.map((b) => (
            <Cell key={b.db} fill={fill(b.db)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
