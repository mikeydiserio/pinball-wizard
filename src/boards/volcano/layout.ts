/**
 * Eruption playfield layout. World units: x grows to the right, z grows toward
 * the player (down the table). Only the cabinet shell, flippers, slingshots,
 * out-lanes, and plunger chute follow the house standard; the playfield above
 * the slings is its own design: a domed crown, a raised caldera at top center
 * fed by a right-hand ramp, a wire habitrail down to the right inlane, the
 * pressure gauge in the right orbit, and a magma chamber in the upper middle.
 */
export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]
export type SegmentKind = 'wall' | 'guide' | 'sling' | 'gate'
export interface Segment { a: Vec2; b: Vec2; kind: SegmentKind; radius?: number; elevation?: number; height?: number }

export const TABLE = { left: -3.5, right: 3.5, top: -6.3, bottom: 6.3 } as const
export const BALL_RADIUS = 0.16
export const BALL_Y = 0.23

export const FLIPPER = {
  length: 1.05, radius: 0.16, tipRadius: 0.1, pivotZ: 4.75,
  leftX: -1.53, rightX: 1.03, rest: 0.38, raised: -0.5,
} as const

/** Ball rest position on the plunger tip inside the magma chute. */
export const SERVE = { x: 3.175, z: 5.6 } as const

/** Smooth Catmull-Rom polyline through control points. */
function spline<T extends Vec2 | Vec3>(controls: readonly T[], samples: number): T[] {
  const points: T[] = []
  controls.slice(0, -1).forEach((p1, i) => {
    const p0 = controls[Math.max(0, i - 1)], p2 = controls[i + 1], p3 = controls[Math.min(controls.length - 1, i + 2)]
    for (let j = 0; j < samples; j++) {
      const t = j / samples
      points.push(p1.map((_, k) => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t)) as unknown as T)
    }
  })
  points.push(controls[controls.length - 1])
  return points
}

/** Symmetric volcanic dome: a broad, even crown so orbits sweep cleanly side to side. */
const CROWN: readonly Vec2[] = [[-3.5, -3.2], [-3.38, -4.35], [-3.0, -5.25], [-2.3, -5.85], [-1.2, -6.17], [0, -6.25], [1.2, -6.17], [2.3, -5.85], [3.0, -5.25], [3.38, -4.35], [3.5, -3.2]]
const crownPoints = spline(CROWN, 6)
export const ARC_SEGMENTS: readonly Segment[] = crownPoints.slice(1).map((b, i) => ({ a: crownPoints[i], b, kind: 'wall' as const }))

const sling = (top: Vec2, bottom: Vec2, inner: Vec2): Segment[] => [
  { a: top, b: bottom, kind: 'guide' },
  { a: bottom, b: inner, kind: 'guide' },
  { a: inner, b: top, kind: 'sling' },
]

/** Basalt slingshots. Only the inner face kicks. */
export const SLINGS = {
  left: [[-2.25, 2.4], [-2.25, 3.6], [-1.6, 4.05]] as const,
  right: [[1.75, 2.4], [1.75, 3.6], [1.1, 4.05]] as const,
}

/** Summit lanes sit under the upper-left crown. */
export const SUMMIT_DIVIDERS = [-2.85, -2.35, -1.85, -1.35] as const
export const SUMMIT_LANE_Z = { top: -5.2, bottom: -4.5, rollover: -4.85 } as const
/** The right orbit doubles as the pressure chute. */
export const PRESSURE_LANE = { x: 2.55, guideX: 2.25, top: -3.55, bottom: -0.2 } as const

export const SEGMENTS: readonly Segment[] = [
  // Cabinet walls and the domed crown.
  { a: [-3.5, -3.2], b: [-3.5, 6.3], kind: 'wall' },
  { a: [3.5, -3.2], b: [3.5, 6.3], kind: 'wall' },
  ...ARC_SEGMENTS,
  // Magma chute: plunger lane wall, plunger stop and one-way exit gate.
  { a: [2.85, -2.1], b: [2.85, 4.55], kind: 'wall' },
  { a: [2.85, 5.15], b: [2.85, 6.3], kind: 'wall' },
  { a: [2.85, 5.85], b: [3.5, 5.85], kind: 'wall' },
  { a: [2.85, -2.1], b: [3.5, -2.6], kind: 'gate' },
  // Right orbit / pressure chute and the deflector that turns it into the playfield.
  { a: [PRESSURE_LANE.guideX, PRESSURE_LANE.top], b: [PRESSURE_LANE.guideX, PRESSURE_LANE.bottom], kind: 'guide' },
  { a: [2.85, 0.9], b: [2.42, 1.45], kind: 'guide' },
  // Short left orbit and its exit deflector.
  { a: [-2.9, -4.0], b: [-2.9, -2.3], kind: 'guide' },
  { a: [-3.5, -1.9], b: [-2.95, -1.45], kind: 'guide' },
  // Summit lanes.
  ...SUMMIT_DIVIDERS.map(x => ({ a: [x, SUMMIT_LANE_Z.top] as Vec2, b: [x, SUMMIT_LANE_Z.bottom] as Vec2, kind: 'guide' as const })),
  // Lower lanes: out lanes and inlanes.
  { a: [-2.88, 2.7], b: [-2.88, 3.95], kind: 'guide' },
  { a: [-2.88, 3.95], b: [-2.25, 4.42], kind: 'guide', radius: 0.16 },
  { a: [-2.25, 4.42], b: [-1.53, 4.75], kind: 'guide', radius: 0.16 },
  { a: [2.25, 2.7], b: [2.25, 3.95], kind: 'guide' },
  { a: [2.25, 3.95], b: [1.7, 4.42], kind: 'guide', radius: 0.16 },
  { a: [1.7, 4.42], b: [1.03, 4.75], kind: 'guide', radius: 0.16 },
  ...sling(...SLINGS.left),
  ...sling(...SLINGS.right),
]

export type BumperKind = 'vent' | 'fountain'
/** Boulder bumper (index 0) upper left, a vent cluster lower left, three lava fountains on the caldera. */
export const BUMPERS = [
  { kind: 'vent', x: -1.35, z: -3.05, radius: 0.36, elevation: 0 },
  { kind: 'vent', x: -2.05, z: -0.1, radius: 0.36, elevation: 0 },
  { kind: 'vent', x: -0.75, z: 0.25, radius: 0.36, elevation: 0 },
  { kind: 'vent', x: -1.55, z: 1.45, radius: 0.36, elevation: 0 },
  { kind: 'fountain', x: -0.8, z: -5.25, radius: 0.22, elevation: 0.85 },
  { kind: 'fountain', x: 0.8, z: -5.25, radius: 0.22, elevation: 0.85 },
  { kind: 'fountain', x: 0, z: -4.45, radius: 0.22, elevation: 0.85 },
] as const satisfies readonly { kind: BumperKind; x: number; z: number; radius: number; elevation: number }[]

export type TargetGroup = 'pressure' | 'survey' | 'tube' | 'ash' | 'bomb'
/** Thirteen spot targets; hazard banks remain standing when hit. */
export const TARGETS = [
  { group: 'pressure', x: 2.05, z: -1.9, radius: .12 },
  { group: 'pressure', x: 2.05, z: -1.55, radius: .12 },
  { group: 'pressure', x: 2.05, z: -1.2, radius: .12 },
  { group: 'survey', x: -0.55, z: 1.05, radius: .12 },
  { group: 'survey', x: -0.2, z: 1.05, radius: .12 },
  { group: 'survey', x: 0.15, z: 1.05, radius: .12 },
  { group: 'tube', x: 0.6, z: -3.75, radius: .12 },
  { group: 'ash', x: -3.3, z: -0.85, radius: .12 },
  { group: 'ash', x: -3.3, z: -0.5, radius: .12 },
  { group: 'ash', x: -3.3, z: -0.15, radius: .12 },
  { group: 'bomb', x: 2.05, z: 0.35, radius: .12 },
  { group: 'bomb', x: 2.05, z: 0.7, radius: .12 },
  { group: 'bomb', x: 2.05, z: 1.05, radius: .12 },
] as const satisfies readonly { group: TargetGroup; x: number; z: number; radius: number }[]
/** The point a spot target's face looks toward. */
export function targetFace(target: { group: TargetGroup; x: number; z: number }): Vec2 {
  switch (target.group) {
    case 'pressure': case 'bomb': return [target.x - 1, target.z]
    case 'ash': return [target.x + 1, target.z]
    case 'survey': return [target.x, target.z + 1]
    case 'tube': return [-0.25, 4.4]
  }
}

/** Nine obsidian drop targets: fissure (multiplier), geology badge, and booster banks. */
export const DROPS = [
  { bank: 0, x: -2.15, z: -1.95, radius: .13 },
  { bank: 0, x: -1.95, z: -1.68, radius: .13 },
  { bank: 0, x: -1.75, z: -1.41, radius: .13 },
  { bank: 1, x: .1, z: -.05, radius: .13 },
  { bank: 1, x: .42, z: -.05, radius: .13 },
  { bank: 1, x: .74, z: -.05, radius: .13 },
  { bank: 2, x: -2.45, z: -3.6, radius: .13 },
  { bank: 2, x: -2.12, z: -3.72, radius: .13 },
  { bank: 2, x: -1.79, z: -3.84, radius: .13 },
] as const
/** Point each drop bank faces. */
export const DROP_FACE: readonly Vec2[] = [[1.0, 4.4], [.42, 5], [.2, 2]]

export type RolloverKind = 'summit' | 'fumarole' | 'bonus' | 'return' | 'out' | 'pressure' | 'crater' | 'skill'
/** Caldera lanes on the raised deck, crossed on the way to the habitrail. */
export const RIM_LANES = { x: [-0.4, 0, 0.4], z: -4.3, z0: -4.45, z1: -4.15, dividers: [-0.6, -0.2, 0.2, 0.6] } as const
/** Indices are fixed: 0-2 summit, 3 fumarole, 4 left out, 5 bonus, 6-7 returns, 8 right out, 9-14 pressure, 15-17 caldera lanes, 18 skill. */
export const ROLLOVERS = [
  ...[-2.6, -2.1, -1.6].map(x => ({ kind: 'summit' as const, x, z: SUMMIT_LANE_Z.rollover, radius: .24 })),
  { kind: 'fumarole', x: -3.2, z: -2.85, radius: .24 },
  { kind: 'out', x: -3.19, z: 3.6, radius: .24 },
  { kind: 'bonus', x: 2.0, z: 2.45, radius: .24 },
  { kind: 'return', x: -2.565, z: 3.45, radius: .24 },
  { kind: 'return', x: 2.0, z: 3.25, radius: .24 },
  { kind: 'out', x: 2.55, z: 3.6, radius: .24 },
  ...Array.from({ length: 6 }, (_, i) => ({ kind: 'pressure' as const, x: PRESSURE_LANE.x, z: -.45 - i * .6, radius: .25 })),
  ...RIM_LANES.x.map(x => ({ kind: 'crater' as const, x, z: RIM_LANES.z, radius: .21 })),
  { kind: 'skill', x: 2.63, z: 4.85, radius: .23 },
] as const satisfies readonly { kind: RolloverKind; x: number; z: number; radius: number }[]

/** Ash vanes: one across the pressure chute, one guarding the ramp mouth. */
export const SPINNERS = [
  { x0: 2.25, x1: 2.85, z: -3.15 },
  { x0: .9, x1: 1.65, z: .25 },
] as const

export type SaucerKind = 'crater' | 'lavaLake' | 'escape'
/** Kickout holes: summit crater, lava lake, and the escape tunnel. */
export const SAUCERS = [
  { kind: 'crater', x: -0.2, z: -3.45, radius: 0.32, eject: [0.6, 4.4] as Vec2 },
  { kind: 'lavaLake', x: -2.4, z: -0.85, radius: 0.2, eject: [5.5, -3] as Vec2 },
  { kind: 'escape', x: 1.3, z: 1.55, radius: 0.2, eject: [0, -14] as Vec2 },
] as const satisfies readonly { kind: SaucerKind; x: number; z: number; radius: number; eject: Vec2 }[]

/** Lava tubes. Closed tubes return to the entrance; open tubes use the selected exit color. */
export const TUBES = [
  { name: 'magma', x: -2.45, z: -2.95, radius: 0.22, color: '#ff3d1f' },
  { name: 'obsidian', x: 0.95, z: -3.3, radius: 0.22, color: '#9b6bff' },
  { name: 'sulfur', x: -0.15, z: 2.75, radius: 0.22, color: '#f4e04d' },
] as const

/** Out-lane kickbacks. */
export const KICKERS = [
  { x: -3.19, z: 4.45, radius: 0.22 },
  { x: 2.55, z: 4.45, radius: 0.22 },
] as const

/** Magma chamber in the upper middle; the eighteen heat lights ring it. */
export const MAGMA_CHAMBER = { x: -0.25, z: -1.6, radius: 0.88, core: 0.42 } as const
export const CENTER_POST = { x: -0.25, z: 5.45, radius: 0.11 } as const

/** Raised caldera at top center. Its underside clears a ground-level ball. */
export const DECK_Y = 0.85
export const DECK_OUTLINE: readonly Vec2[] = [
  [-1.15, -5.55], [-0.7, -5.95], [0.2, -6.05], [0.95, -5.9], [1.2, -5.4],
  [1.15, -4.7], [0.6, -4.05], [-0.6, -4.05], [-1.2, -4.7],
]
/** The caldera's one open edge, between its lane exits, drains to the habitrail. */
const DECK_EXIT_EDGE = 6
export const DECK_RAILS: readonly Segment[] = DECK_OUTLINE.map((a, i) => ({
  a, b: DECK_OUTLINE[(i + 1) % DECK_OUTLINE.length], kind: 'guide' as const,
  elevation: DECK_Y, height: 0.28,
})).filter((_, i) => i !== DECK_EXIT_EDGE).concat(
  RIM_LANES.dividers.map(x => ({ a: [x, -4.55] as Vec2, b: [x, -4.1] as Vec2, kind: 'guide' as const, elevation: DECK_Y, height: .28 })),
)
export function onCraterRim(x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = DECK_OUTLINE.length - 1; i < DECK_OUTLINE.length; j = i++) {
    const a = DECK_OUTLINE[i], b = DECK_OUTLINE[j]
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
/** Right-hand ramp: climbs the right side, then swings left onto the caldera. */
export const RAMP_ENTRY = { x0: .9, x1: 1.65, z0: -0.35, z1: 0.1 } as const
export const RAMP_WIDTH = 0.76
export const RAMP_PATH: readonly Vec3[] = spline<Vec3>([
  [1.25, 0, 0.0], [1.3, .3, -0.8], [1.38, .65, -1.8], [1.56, .95, -2.9], [1.75, 1.1, -3.9],
  [1.68, 1.15, -4.8], [1.25, 1.0, -5.45], [0.7, DECK_Y, -5.75], [0.05, DECK_Y, -5.8],
], 16)
/** Wire habitrail from the caldera exit down to the top of the right inlane. Heights are above the playfield. */
export const HABITRAIL_PATH: readonly Vec3[] = spline<Vec3>([
  [0, DECK_Y, -3.95], [0.25, .95, -3.2], [0.45, 1.0, -2.3], [0.55, 1.0, -1.0],
  [0.75, .95, 0.2], [1.25, .85, 0.95], [1.75, .65, 1.55], [2.0, .3, 1.95], [2.0, 0, 2.2],
], 12)

export const DRAIN_Z = 6.05
export const OUTLANE_DRAIN_Z = 5.0
export const isOutlane = (x: number) => x < -2.88 || (x > 2.25 && x < 2.85)

export type LightKey =
  | 'pressure' | 'pressureTarget' | 'fissure' | 'fumarole' | 'hazard' | 'summit'
  | 'craterLanes' | 'reflex' | 'tremor' | 'expeditionAccept' | 'surveyTarget' | 'tilt'
  | 'extraBall' | 'bonusLane' | 'returnLane' | 'outLane' | 'kicker' | 'replay'
  | 'eruption' | 'craterRing' | 'lavaLake' | 'escape' | 'tube'
  | 'tubeTarget' | 'badge' | 'cataclysm' | 'deployment' | 'booster'
  | 'rank' | 'progress' | 'redeploy' | 'chamber' | 'tubeExit' | 'vane' | 'deploymentArrow' | 'expeditionArrow' | 'centerPost'
export type InsertShape = 'circle' | 'arrow' | 'triangle' | 'rect' | 'cross' | 'ring'
export interface Insert {
  light: LightKey
  index?: number
  x: number
  z: number
  shape: InsertShape
  size: number
  color: string
  /** World direction the insert points toward. */
  toward?: Vec2
}

/** Lava palette shared by the inserts, art, and hardware. */
export const LAVA = {
  red: '#ff3d1f', orange: '#ff8a1f', amber: '#ffc23a', sulfur: '#f4e04d', white: '#fff4d6',
  obsidian: '#9b6bff', steam: '#46e0c0', ash: '#c9c2b8', ember: '#b8321a',
} as const

const along = (from: Vec2, to: Vec2, t: number): Vec2 => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
/** Inserts leading up the approach to the ramp mouth. */
const rampLine = (t: number) => along([0.35, 1.95], [1.05, 0.6], t)
const RAMP_MOUTH: Vec2 = [1.25, 0]
const CRATER: Vec2 = [SAUCERS[0].x, SAUCERS[0].z]
/** Orbit chase lamps in the order the plunger shot travels: up the right, across the crown, down the left lane. */
const ORBIT_CHASE: readonly Vec2[] = [[3.15, -3.4], [3.05, -4.3], [2.7, -5.0], [2.0, -5.55], [-1.55, -5.8], [-2.3, -5.5], [-3.05, -4.75], [-3.2, -4.05], [-3.2, -3.45]]
/** Lamps laid along a drop bank, set in front of it by `offset`. */
const bankLamps = (bank: number, count: number, offset: number): Vec2[] => {
  const drops = DROPS.filter(d => d.bank === bank)
  const first: Vec2 = [drops[0].x, drops[0].z], last: Vec2 = [drops[2].x, drops[2].z]
  const mid = along(first, last, .5), face = DROP_FACE[bank]
  const length = Math.hypot(face[0] - mid[0], face[1] - mid[1])
  const dx = (face[0] - mid[0]) / length * offset, dz = (face[1] - mid[1]) / length * offset
  return Array.from({ length: count }, (_, i) => { const [x, z] = along(first, last, count === 1 ? .5 : -.1 + 1.2 * i / (count - 1)); return [x + dx, z + dz] })
}

export const INSERTS: readonly Insert[] = [
  { light: 'centerPost', x: CENTER_POST.x, z: CENTER_POST.z - .25, shape: 'circle', size: .07, color: LAVA.orange },
  // Steam-teal expedition arrows follow the current objective, including each Three Rivers tube.
  ...([
    [0.62, 0.55, ...RAMP_MOUTH], [-2.1, -4.25, -2.1, -4.85], [-0.6, 0.0, -1.0, 0.55], [0.42, 0.4, 0.42, -0.05],
    [-2.75, -0.5, -3.3, -0.5], [1.6, 0.95, 2.05, 0.7], [0.2, -3.0, ...CRATER], [-1.85, -0.55, -2.4, -0.85],
    [2.55, 0.25, 2.55, -1.0], [-3.2, -2.0, -3.2, -2.85], [-0.85, -3.75, -1.35, -3.05], [-3.15, 2.9, -3.19, 3.6],
    [2.45, 2.7, 2.55, 3.6], [1.15, -3.95, 0.5, -4.6], [-1.95, -2.55, -2.45, -2.95], [0.45, -2.75, 0.95, -3.3],
    [-0.85, 2.35, -0.15, 2.75], [1.35, 0.8, 1.3, 0.25], [-1.45, 2.75, -1.95, 3.15],
  ] as const).map(([x, z, tx, tz], index): Insert => ({ light: 'expeditionArrow', index, x, z, toward: [tx, tz], shape: 'arrow', size: .1, color: LAVA.steam })),
  { light: 'chamber', x: MAGMA_CHAMBER.x, z: MAGMA_CHAMBER.z, shape: 'circle', size: .15, color: LAVA.orange },
  ...TUBES.map((t, index): Insert => ({ light: 'tubeExit', index, x: t.x, z: t.z + .4, shape: 'arrow', size: .12, color: '#ffffff', toward: [t.x, t.z] })),
  { light: 'vane', index: 0, x: 3.05, z: SPINNERS[0].z, shape: 'circle', size: .065, color: LAVA.sulfur },
  { light: 'vane', index: 1, x: (SPINNERS[1].x0 + SPINNERS[1].x1) / 2, z: SPINNERS[1].z + .23, shape: 'circle', size: .065, color: LAVA.sulfur },
  // Flame chase hugging the crown, each tongue pointing the way the ball travels.
  ...ORBIT_CHASE.map(([x, z], index): Insert => {
    const next = ORBIT_CHASE[index + 1] ?? [x, z + 1]
    return { light: 'deploymentArrow', index, x, z, shape: 'triangle', size: .085, color: LAVA.orange, toward: next }
  }),
  // Pressure gauge up the right orbit; the top rollover glows white-hot.
  ...ROLLOVERS.slice(9, 15).map((r, index): Insert => ({ light: 'pressure', index, x: r.x, z: r.z, shape: 'rect', size: .08, color: index === 5 ? LAVA.white : LAVA.orange })),
  ...[-1, 0, 1].map((offset, index): Insert => {
    const [x, z] = rampLine(.25)
    return { light: 'craterLanes', index, x: x + offset * .19, z: z + offset * .1, shape: 'circle', size: .075, color: LAVA.red }
  }),
  { light: 'tremor', x: rampLine(.5)[0], z: rampLine(.5)[1], shape: 'arrow', size: 0.15, color: LAVA.obsidian, toward: RAMP_MOUTH },
  { light: 'reflex', x: rampLine(.7)[0], z: rampLine(.7)[1], shape: 'arrow', size: 0.16, color: LAVA.amber, toward: RAMP_MOUTH },
  { light: 'expeditionAccept', x: rampLine(.9)[0], z: rampLine(.9)[1], shape: 'arrow', size: 0.2, color: LAVA.red, toward: RAMP_MOUTH },
  // Pressure targets, fissure multiplier, fumarole, and hazard banks.
  ...TARGETS.slice(0, 3).map((t, index): Insert => ({ light: 'pressureTarget', index, x: t.x - .22, z: t.z, shape: 'circle', size: 0.06, color: LAVA.amber })),
  ...bankLamps(0, 4, .34).map(([x, z], index): Insert => ({ light: 'fissure', index, x, z, shape: 'triangle', size: .07, color: LAVA.orange, toward: [DROPS[1].x, DROPS[1].z] })),
  { light: 'fumarole', x: -3.2, z: -1.6, shape: 'arrow', size: 0.12, color: LAVA.steam, toward: [-3.2, -2.85] },
  ...TARGETS.slice(7).map((d, i): Insert => ({ light: 'hazard', index: i, x: d.x + (i >= 3 ? -0.3 : 0.3), z: d.z, shape: 'triangle', size: 0.075, color: i >= 3 ? LAVA.red : LAVA.ash, toward: [d.x, d.z] })),
  // Survey targets, tilt, extra ball, lower lanes, kickbacks.
  ...TARGETS.slice(3, 6).map((t, index): Insert => ({ light: 'surveyTarget', index, x: t.x, z: t.z + .3, shape: 'circle', size: 0.065, color: LAVA.steam })),
  { light: 'tilt', x: 0.95, z: 3.05, shape: 'cross', size: 0.15, color: '#ff2a2a' },
  { light: 'extraBall', x: -1.55, z: 2.0, shape: 'circle', size: 0.1, color: LAVA.white },
  { light: 'extraBall', x: 1.15, z: 2.25, shape: 'circle', size: 0.1, color: LAVA.white },
  { light: 'outLane', index: 0, x: -3.19, z: 3.15, shape: 'triangle', size: 0.08, color: LAVA.red, toward: [-3.19, 4] },
  { light: 'bonusLane', x: 2.0, z: 2.1, shape: 'triangle', size: 0.075, color: LAVA.amber, toward: [2.0, 4] },
  { light: 'returnLane', index: 0, x: -2.565, z: 3.85, shape: 'triangle', size: 0.075, color: LAVA.steam, toward: [-2.565, 5] },
  { light: 'returnLane', index: 1, x: 2.0, z: 3.65, shape: 'triangle', size: 0.075, color: LAVA.steam, toward: [2.0, 5] },
  { light: 'outLane', index: 1, x: 2.55, z: 3.15, shape: 'triangle', size: 0.08, color: LAVA.red, toward: [2.55, 4] },
  { light: 'kicker', index: 0, x: -3.19, z: 4.05, shape: 'arrow', size: 0.12, color: LAVA.orange, toward: [-3.19, 2] },
  { light: 'kicker', index: 1, x: 2.55, z: 4.05, shape: 'arrow', size: 0.12, color: LAVA.orange, toward: [2.55, 2] },
  // Replay and re-deploy sit just above the flippers.
  { light: 'replay', x: -0.75, z: 4.05, shape: 'rect', size: 0.12, color: LAVA.obsidian },
  { light: 'redeploy', x: 0.25, z: 4.05, shape: 'rect', size: 0.12, color: LAVA.steam },
  // Summit lane lights and the kickout / tube halos.
  ...ROLLOVERS.slice(0, 3).map((r, index): Insert => ({ light: 'summit', index, x: r.x, z: -5.1, shape: 'circle', size: 0.075, color: LAVA.amber })),
  ...SAUCERS.map((s): Insert => ({ light: s.kind === 'crater' ? 'craterRing' : s.kind, x: s.x, z: s.z, shape: 'ring', size: s.kind === 'crater' ? 0.39 : 0.29, color: s.kind === 'crater' ? LAVA.red : s.kind === 'lavaLake' ? LAVA.orange : LAVA.steam })),
  ...TUBES.map((t, index): Insert => ({ light: 'tube', index, x: t.x, z: t.z, shape: 'ring', size: 0.32, color: t.color })),
  // Eruption ladder: four flames inside the chamber, filling clockwise from the crater side.
  ...Array.from({ length: 4 }, (_, index): Insert => {
    const angle = -Math.PI / 2 + index * Math.PI / 2
    const x = MAGMA_CHAMBER.x + Math.cos(angle) * .5, z = MAGMA_CHAMBER.z + Math.sin(angle) * .5
    return { light: 'eruption', index, x, z, shape: 'triangle', size: 0.09, color: LAVA.red, toward: [MAGMA_CHAMBER.x + Math.cos(angle) * 2, MAGMA_CHAMBER.z + Math.sin(angle) * 2] }
  }),
  { light: 'tubeTarget', x: TARGETS[6].x + .25, z: TARGETS[6].z + .1, shape: 'circle', size: 0.065, color: LAVA.obsidian },
  ...DROPS.slice(3, 6).map((t, index): Insert => ({ light: 'badge', index, x: t.x, z: t.z - 0.33, shape: 'circle', size: 0.07, color: LAVA.sulfur })),
  // Crater approach: reflex, tremor, and cataclysm arrows stack up the center line.
  { light: 'reflex', index: 1, x: MAGMA_CHAMBER.x, z: 0.75, shape: 'arrow', size: 0.14, color: LAVA.amber, toward: CRATER },
  { light: 'tremor', x: MAGMA_CHAMBER.x, z: 0.4, shape: 'arrow', size: 0.14, color: LAVA.obsidian, toward: CRATER },
  { light: 'cataclysm', x: MAGMA_CHAMBER.x, z: 0.05, shape: 'arrow', size: 0.15, color: LAVA.red, toward: [MAGMA_CHAMBER.x, MAGMA_CHAMBER.z] },
  // Deployment lights in the chute and booster lights beside the upper-left bank.
  ...Array.from({ length: 6 }, (_, index): Insert => ({ light: 'deployment', index, x: SERVE.x, z: 4.25 - index * 0.62, shape: 'triangle', size: 0.08, color: LAVA.amber, toward: [SERVE.x, -6] })),
  ...bankLamps(2, 4, .34).map(([x, z], index): Insert => ({ light: 'booster', index, x, z, shape: 'circle', size: 0.065, color: LAVA.steam })),
  // Nine rank flames in a row above the flippers.
  ...Array.from({ length: 9 }, (_, index): Insert => ({ light: 'rank', index, x: -1.21 + index * .24, z: 3.45, shape: 'triangle', size: 0.09, color: '#ffd27a', toward: [-1.21 + index * .24, 0] })),
  // Eighteen heat lights ring the magma chamber.
  ...Array.from({ length: 18 }, (_, index): Insert => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 18
    return { light: 'progress', index, x: MAGMA_CHAMBER.x + Math.cos(angle) * 1.13, z: MAGMA_CHAMBER.z + Math.sin(angle) * 1.13, shape: 'circle', size: 0.065, color: LAVA.ember }
  }),
]
