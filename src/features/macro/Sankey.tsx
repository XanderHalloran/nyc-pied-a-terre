/**
 * A Sankey with the layout given rather than solved.
 *
 * Every flow on this site is a fixed, hand-authored shape — boroughs on the left, an outcome split
 * on the right — so there is no crossing to minimise and no iterative relaxation to run. Column
 * assignment IS the layout, which is why this is 90 lines and not a dependency.
 * ponytail: if a diagram ever needs computed ordering, that is the moment to reach for d3-sankey.
 *
 * One unit per diagram. A Sankey's whole claim is that width means the same thing everywhere in
 * it, so properties and dollars get two diagrams rather than two halves of one — see `unit`, which
 * is required for exactly that reason.
 */

export type SankeyNode = {
  id: string
  label: string
  /** Column index, 0 on the left. Heights come from the links, never from a value set here. */
  col: number
  /** Fill for this node and for the links leaving it. Identity, so it never follows rank. */
  color?: string
  /** Overrides the value shown beside the label — for a node whose total is worth wording. */
  note?: string
}

export type SankeyLink = { from: string; to: string; value: number; title?: string }

type Props = {
  nodes: SankeyNode[]
  links: SankeyLink[]
  /** What one unit of width is. Rendered on the diagram, because a Sankey without it lies. */
  unit: string
  format: (v: number) => string
  height?: number
  /** Labels sit outside the end columns, so those need room. */
  padLeft?: number
  padRight?: number
}

const NODE_W = 11
const GAP = 2 // the 2px surface gap that keeps adjacent ribbons from reading as one mark

export default function Sankey({ nodes, links, unit, format, height = 300, padLeft = 132, padRight = 150 }: Props) {
  const cols = Math.max(...nodes.map((n) => n.col)) + 1
  const W = 900
  const H = height
  const top = 22
  const usable = H - top - 10
  const colX = (c: number) => padLeft + (c * (W - padLeft - padRight - NODE_W)) / Math.max(1, cols - 1)

  // A node is as tall as what flows through it. Sinks have no outgoing links, sources no incoming,
  // and a node that is both takes the larger side so nothing is ever drawn wider than its node.
  const total = (id: string, side: 'in' | 'out') =>
    links.filter((l) => (side === 'in' ? l.to : l.from) === id).reduce((a, l) => a + l.value, 0)
  const size = (id: string) => Math.max(total(id, 'in'), total(id, 'out'))

  // Scale is set by the fullest column, so every column of the same diagram shares one scale.
  const colTotal = (c: number) => nodes.filter((n) => n.col === c).reduce((a, n) => a + size(n.id), 0)
  const maxTotal = Math.max(...Array.from({ length: cols }, (_, c) => colTotal(c)))
  const gapsFor = (c: number) => Math.max(0, nodes.filter((n) => n.col === c).length - 1) * GAP
  const scale = (usable - Math.max(...Array.from({ length: cols }, (_, c) => gapsFor(c)))) / maxTotal

  // Vertical placement: stack each column in the order given, centred against the tallest column.
  const box: Record<string, { x: number; y: number; h: number }> = {}
  for (let c = 0; c < cols; c++) {
    const inCol = nodes.filter((n) => n.col === c)
    const stack = inCol.reduce((a, n) => a + size(n.id) * scale, 0) + gapsFor(c)
    let y = top + (usable - stack) / 2
    for (const n of inCol) {
      const h = size(n.id) * scale
      box[n.id] = { x: colX(c), y, h }
      y += h + GAP
    }
  }

  // A node one pixel tall still has a two-line label, so on a roll this lopsided the small
  // boroughs' labels land on top of each other. Two passes: push each label below the previous,
  // then push back up from the bottom so the last one cannot walk off the diagram and land on the
  // paragraph underneath. A label that moved gets a leader back to the node it belongs to.
  // ponytail: no force simulation. If a column ever has more labels than fit between these two
  // bounds they compress instead of colliding, and the fix then is fewer nodes.
  const LABEL_H = 30
  const minY = top + 8
  const maxY = H - 18 // the second line sits ~15px below the first
  const labelY: Record<string, number> = {}
  for (let c = 0; c < cols; c++) {
    const inCol = nodes.filter((x) => x.col === c && box[x.id])
    let floor = minY - LABEL_H
    const ys = inCol.map((nd) => {
      const b = box[nd.id]
      const y = Math.max(b.y + b.h / 2, floor + LABEL_H)
      floor = y
      return y
    })
    let ceil = maxY + LABEL_H
    for (let i = ys.length - 1; i >= 0; i--) {
      ys[i] = Math.max(minY, Math.min(ys[i], ceil - LABEL_H))
      ceil = ys[i]
    }
    inCol.forEach((nd, i) => { labelY[nd.id] = ys[i] })
  }

  // Ribbons leave and arrive in the order the links were given, which is the order the nodes are
  // stacked in — so flows stay parallel instead of crossing for no reason.
  const outAt: Record<string, number> = {}
  const inAt: Record<string, number> = {}
  const ribbons = links.map((l, i) => {
    const a = box[l.from], b = box[l.to]
    if (!a || !b) return null
    const t = l.value * scale
    const y0 = a.y + (outAt[l.from] ?? 0)
    const y1 = b.y + (inAt[l.to] ?? 0)
    outAt[l.from] = (outAt[l.from] ?? 0) + t
    inAt[l.to] = (inAt[l.to] ?? 0) + t
    const x0 = a.x + NODE_W
    const x1 = b.x
    const mx = (x0 + x1) / 2
    const d = `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + t} C${mx},${y1 + t} ${mx},${y0 + t} ${x0},${y0 + t} Z`
    const color = nodes.find((n) => n.id === l.from)?.color ?? 'var(--fg-3)'
    return (
      <path key={i} className="ribbon" d={d} fill={color}>
        <title>{l.title ?? `${l.from} → ${l.to}: ${format(l.value)} ${unit}`}</title>
      </path>
    )
  })

  return (
    // Scrolls sideways on a phone rather than scaling: a 900-wide viewBox squeezed into 390px puts
    // the labels at about 5px, which is not a smaller chart, it is an unreadable one.
    <div className="sankey-wrap">
    <svg className="sankey" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Flow diagram, ${unit}`}>
      <text x={0} y={12} className="sk-unit">width = {unit}</text>
      <g>{ribbons}</g>
      {nodes.map((n) => {
        const b = box[n.id]
        if (!b) return null
        const last = n.col === cols - 1
        // A middle column has ribbons on both sides, so its label goes above the node instead of
        // into a flow it would sit on top of.
        // A middle column has ribbons on both sides and often fills the height, so there is no
        // clear space to put its label in. It sits on the node with a surface halo behind it
        // instead — the same trick as the 2px ring the mark spec asks for on overlapping marks.
        const mid = n.col > 0 && !last
        const lx = mid ? b.x + NODE_W / 2 : last ? b.x + NODE_W + 8 : b.x - 8
        const ly = mid ? b.y + b.h / 2 : labelY[n.id]
        const moved = !mid && Math.abs(ly - (b.y + b.h / 2)) > 3
        return (
          <g key={n.id}>
            <rect x={b.x} y={b.y} width={NODE_W} height={Math.max(1, b.h)} rx={2} fill={n.color ?? 'var(--fg-3)'} />
            {/* A pushed label no longer points at its own node, so it gets a leader back to it. */}
            {moved && (
              <path
                className="sk-leader"
                d={`M${lx + (last ? -4 : 4)},${ly} L${last ? b.x + NODE_W + 2 : b.x - 2},${b.y + b.h / 2}`}
                stroke={n.color ?? 'var(--fg-3)'}
              />
            )}
            {/* Direct labels on every node, not a legend to cross-reference. They are also the
                relief the contrast check requires where a fill sits under 3:1 on a light surface. */}
            <text className={mid ? 'sk-label sk-on-mark' : 'sk-label'} x={lx} y={ly} textAnchor={mid ? 'middle' : last ? 'start' : 'end'}>
              <tspan>{n.label}</tspan>
              <tspan className="sk-value" x={lx} dy="1.2em">
                {n.note ?? format(size(n.id))}
              </tspan>
            </text>
          </g>
        )
      })}
    </svg>
    </div>
  )
}
