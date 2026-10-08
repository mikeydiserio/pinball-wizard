/**
 * Space Cadet playfield layout. World units: x grows to the right, z grows
 * toward the player (down the table). Legend numbers from the reference
 * table art are noted beside each element.
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

/** Ball rest position on the plunger tip inside the deployment chute (50). */
export const SERVE = { x: 3.175, z: 5.6 } as const
export const ARC = { cx: 0, cz: -3.8, rx: 3.5, rz: 2.5, segments: 30 } as const

function arcSegments(): Segment[] {
  // Asymmetric crown: a separate upper-left bumper pocket joins the broad top orbit.
  const controls: Vec2[] = [[-3.5,-3.8],[-3.28,-4.43],[-3.46,-5.0],[-3.27,-5.73],[-2.8,-6.08],[-2.24,-6.03],[-1.77,-5.66],[-.8,-6.0],[.1,-6.08],[1.1,-5.89],[2.1,-5.32],[2.94,-4.62],[3.5,-3.8]]
  const points: Vec2[] = []
  controls.slice(0,-1).forEach((p1,i)=>{
    const p0=controls[Math.max(0,i-1)],p2=controls[i+1],p3=controls[Math.min(controls.length-1,i+2)]
    for(let j=0;j<6;j++) {
      const t=j/6
      points.push([0,1].map(k=>.5*(2*p1[k]+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t*t+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t*t*t)) as unknown as Vec2)
    }
  })
  points.push(controls[controls.length-1])
  return points.slice(1).map((b,i)=>({a:points[i],b,kind:'wall' as const}))
}

export const ARC_SEGMENTS = arcSegments()

const sling = (top: Vec2, bottom: Vec2, inner: Vec2): Segment[] => [
  { a: top, b: bottom, kind: 'guide' },
  { a: bottom, b: inner, kind: 'guide' },
  { a: inner, b: top, kind: 'sling' },
]

/** Rebound slingshots (22, 49). Only the inner face kicks. */
export const SLINGS = {
  left: [[-2.25, 2.4], [-2.25, 3.6], [-1.6, 4.05]] as const,
  right: [[1.75, 2.4], [1.75, 3.6], [1.1, 4.05]] as const,
}

export const REENTRY_DIVIDERS = [-0.25, 0.35, 0.95, 1.55] as const

export const SEGMENTS: readonly Segment[] = [
  // Cabinet walls and the sweeping top arc.
  { a: [-3.5, ARC.cz], b: [-3.5, 6.3], kind: 'wall' },
  { a: [3.5, ARC.cz], b: [3.5, 6.3], kind: 'wall' },
  ...ARC_SEGMENTS,
  // Deployment chute (50): plunger lane wall, plunger stop and one-way exit gate.
  { a: [2.85, -2.1], b: [2.85, 4.55], kind: 'wall' },
  { a: [2.85, 5.15], b: [2.85, 6.3], kind: 'wall' },
  { a: [2.85, 5.85], b: [3.5, 5.85], kind: 'wall' },
  { a: [2.85, -2.1], b: [3.5, -2.6], kind: 'gate' },
  // Left orbit lane, its exit deflector, and the mouth of the launch ramp (8).
  { a: [-2.95, -3.6], b: [-2.95, -1.25], kind: 'guide' },
  { a: [-3.5, -1.05], b: [-3.0, -0.6], kind: 'guide' },
  
  
  // Right orbit lane behind the right hazard bank (29).
  { a: [2.72, -3.75], b: [2.72, -2.65], kind: 'guide' },
  // Re-entry lanes (26).
  ...REENTRY_DIVIDERS.map(x => ({ a: [x, -5.2] as Vec2, b: [x, -4.5] as Vec2, kind: 'guide' as const })),
  // Lower lanes: out lane (19, 47), bonus / return lanes (20, 21, 48).
  { a: [-2.88, 2.7], b: [-2.88, 3.95], kind: 'guide' },
  { a: [-2.88, 3.95], b: [-2.25, 4.42], kind: 'guide', radius: 0.16 },
  { a: [-2.25, 4.42], b: [-1.53, 4.75], kind: 'guide', radius: 0.16 },
  { a: [2.25, 2.7], b: [2.25, 3.95], kind: 'guide' },
  { a: [2.25, 3.95], b: [1.7, 4.42], kind: 'guide', radius: 0.16 },
  { a: [1.7, 4.42], b: [1.03, 4.75], kind: 'guide', radius: 0.16 },
  { a: [-2.35, -3.0], b: [-1.95, -2.4], kind: 'sling' },
  { a: [2.28, -2.4], b: [1.92, -1.85], kind: 'sling' },
  ...sling(...SLINGS.left),
  ...sling(...SLINGS.right),
]

export type BumperKind = 'attack' | 'launch'
/** Attack bumpers (2, 32) and launch bumpers (15). */
export const BUMPERS = [
  { kind: 'attack', x: -2.55, z: -5.25, radius: 0.36, elevation: 0 },
  { kind: 'attack', x: -0.45, z: -3.05, radius: 0.36, elevation: 0 },
  { kind: 'attack', x: 0.85, z: -3.4, radius: 0.36, elevation: 0 },
  { kind: 'attack', x: 0.05, z: -1.9, radius: 0.36, elevation: 0 },
  { kind: 'launch', x: -3.0, z: 0.2, radius: 0.22, elevation: 0.85 },
  { kind: 'launch', x: -2.22, z: 0.45, radius: 0.22, elevation: 0.85 },
  { kind: 'launch', x: -2.8, z: 1.12, radius: 0.22, elevation: 0.85 },
] as const satisfies readonly { kind: BumperKind; x: number; z: number; radius: number; elevation: number }[]

export type TargetGroup = 'fuel' | 'mission' | 'wormhole' | 'radiation' | 'comet'
/** Thirteen red spot targets; hazards remain standing when hit. */
export const TARGETS = [
  { group: 'fuel', x: -3.12, z: -5.38, radius: .12 },
  { group: 'fuel', x: -2.65, z: -5.9, radius: .12 },
  { group: 'fuel', x: -1.96, z: -5.24, radius: .12 },
  { group: 'mission', x: -3.33, z: .95, radius: .12 },
  { group: 'mission', x: -3.33, z: 1.35, radius: .12 },
  { group: 'mission', x: -3.33, z: 1.75, radius: .12 },
  { group: 'wormhole', x: 1.45, z: -1.95, radius: .12 },
  { group: 'radiation', x: -2.78, z: -3.3, radius: .12 },
  { group: 'radiation', x: -2.78, z: -2.95, radius: .12 },
  { group: 'radiation', x: -2.78, z: -2.6, radius: .12 },
  { group: 'comet', x: 2.55, z: -3.55, radius: .12 },
  { group: 'comet', x: 2.55, z: -3.2, radius: .12 },
  { group: 'comet', x: 2.55, z: -2.85, radius: .12 },
] as const satisfies readonly { group: TargetGroup; x: number; z: number; radius: number }[]

/** Nine yellow drop targets: multiplier, medal, and booster banks. */
export const DROPS = [
  { bank: 0, x: -1.63, z: -4.33, radius: .13 },
  { bank: 0, x: -1.32, z: -4.47, radius: .13 },
  { bank: 0, x: -1.01, z: -4.61, radius: .13 },
  { bank: 1, x: -.5, z: -1.39, radius: .13 },
  { bank: 1, x: -.18, z: -1.34, radius: .13 },
  { bank: 1, x: .14, z: -1.29, radius: .13 },
  { bank: 2, x: 2.68, z: -1.1, radius: .13 },
  { bank: 2, x: 2.68, z: -.6, radius: .13 },
  { bank: 2, x: 2.68, z: -.1, radius: .13 },
] as const

export type RolloverKind = 'reentry' | 'spaceWarp' | 'bonus' | 'return' | 'out' | 'fuel' | 'engine' | 'skill'
export const ROLLOVERS = [
  { kind: 'reentry', x: .05, z: -4.78, radius: .24 },
  { kind: 'reentry', x: .65, z: -4.78, radius: .24 },
  { kind: 'reentry', x: 1.25, z: -4.78, radius: .24 },
  { kind: 'spaceWarp', x: -3.22, z: -4.2, radius: .24 },
  { kind: 'out', x: -3.19, z: 3.6, radius: .24 },
  { kind: 'bonus', x: -2.565, z: 2.65, radius: .24 },
  { kind: 'return', x: -2.565, z: 3.45, radius: .24 },
  { kind: 'return', x: 2.0, z: 3.25, radius: .24 },
  { kind: 'out', x: 2.55, z: 3.6, radius: .24 },
  ...Array.from({ length: 6 }, (_, i) => ({ kind: 'fuel' as const, x: -3.22, z: .2 - i * .7, radius: .25 })),
  ...[-3.0, -2.57, -2.14].map(x => ({ kind: 'engine' as const, x, z: -.32, radius: .21 })),
  { kind: 'skill', x: 2.63, z: 4.85, radius: .23 },
] as const satisfies readonly { kind: RolloverKind; x: number; z: number; radius: number }[]

/** Flags (7, 33): spinners across the two orbit lanes. */
export const SPINNERS = [
  { x0: -3.5, x1: -2.95, z: -1.85 },
  { x0: 2.72, x1: 3.5, z: -3.2 },
] as const

export type SaucerKind = 'hyperspace' | 'blackHole' | 'escape'
/** Kickout holes: hyperspace kickout (27), black hole kickout (9), escape chute (42). */
export const SAUCERS = [
  { kind: 'hyperspace', x: 2.05, z: -4.65, radius: 0.32, eject: [-2.6, 3.4] as Vec2 },
  { kind: 'blackHole', x: -1.7, z: -1.0, radius: 0.2, eject: [7, -1.8] as Vec2 },
  { kind: 'escape', x: 2.45, z: 1.0, radius: 0.2, eject: [2.5, -14] as Vec2 },
] as const satisfies readonly { kind: SaucerKind; x: number; z: number; radius: number; eject: Vec2 }[]

/** Wormholes (3, 28, 41). Closed holes return to the entrance; open holes use the selected exit color. */
export const WORMHOLES = [
  { x: -1.6, z: -3.0, radius: 0.22, color: '#5dff9d' },
  { x: 2.0, z: -3.65, radius: 0.22, color: '#ff4d6d' },
  { x: 2.05, z: 1.9, radius: 0.22, color: '#ffd23f' },
] as const

/** Outlane kickers (23, 52). */
export const KICKERS = [
  { x: -3.19, z: 4.45, radius: 0.22 },
  { x: 2.55, z: 4.45, radius: 0.22 },
] as const

/** Gravity well (43) with the rank lights (44) ringed around it. */
export const GRAVITY_WELL = { x: -0.25, z: 2.05, radius: 0.88, core: 0.42 } as const
export const CENTER_POST = { x: -0.25, z: 5.45, radius: 0.11 } as const

/** Raised launch deck. Its underside clears a ground-level ball by 0.35 units. */
export const DECK_Y = 0.85
export const DECK_OUTLINE: readonly Vec2[] = [
  [-3.35, -0.72], [-3.08, -1.03], [-2.5, -1.0], [-1.95, -0.64],
  [-1.88, 0.35], [-1.93, 1.35], [-2.27, 1.78], [-2.3, 2.35],
  [-2.85, 2.35], [-2.88, 1.73], [-3.35, 1.3],
]
export const DECK_RAILS: readonly Segment[] = DECK_OUTLINE.map((a, i) => ({
  a, b: DECK_OUTLINE[(i + 1) % DECK_OUTLINE.length], kind: 'guide' as const,
  elevation: DECK_Y, height: 0.28,
})).filter((_, i) => i !== 7).concat(
  [-3.215, -2.785, -2.355, -1.925].map(x => ({ a: [x, -.61] as Vec2, b: [x, -.05] as Vec2, kind: 'guide' as const, elevation: DECK_Y, height: .28 })),
)
export function onLaunchDeck(x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = DECK_OUTLINE.length - 1; i < DECK_OUTLINE.length; j = i++) {
    const a = DECK_OUTLINE[i], b = DECK_OUTLINE[j]
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
/** Wide U-shaped ramp feeding the left mini playfield, as in the reference. */
export const RAMP_ENTRY = { x0: -1.92, x1: -1.12, z0: -0.05, z1: 0.38 } as const
export const RAMP_WIDTH = 0.76
const RAMP_CONTROL: readonly Vec3[] = [
  [-1.52, 0, 0.32], [-1.67, 0.3, -0.35], [-1.94, 0.7, -1.15],
  [-2.45, 1.0, -1.65], [-3.03, 1.05, -1.53], [-3.17, 0.98, -1.05],
  [-2.92, DECK_Y, -0.6], [-2.57, DECK_Y, -0.4],
]
// Sample once: renderer and physics use exactly the same smooth centerline.
export const RAMP_PATH: readonly Vec3[] = RAMP_CONTROL.slice(0, -1).flatMap((p1, i) => {
  const p0 = RAMP_CONTROL[Math.max(0, i - 1)], p2 = RAMP_CONTROL[i + 1], p3 = RAMP_CONTROL[Math.min(RAMP_CONTROL.length - 1, i + 2)]
  return Array.from({ length: 16 }, (_, j): Vec3 => {
    const t = j / 16
    return [0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t)) as unknown as Vec3
  })
}).concat([RAMP_CONTROL[RAMP_CONTROL.length - 1]])
/** Right orbit canopy, with open windows and a clear ground-level passage. */
export const ORBIT_CANOPY: readonly Vec3[] = [
  [1.43, .62, -4.95], [1.8, .62, -4.63], [2.17, .62, -4.12],
  [2.36, .62, -3.45], [2.38, .62, -2.75], [2.2, .62, -2.02], [1.92, .62, -1.28],
]

export const DRAIN_Z = 6.05
export const OUTLANE_DRAIN_Z = 5.0
export const isOutlane = (x: number) => x < -2.88 || (x > 2.25 && x < 2.85)

export type LightKey =
  | 'fuel' | 'fuelTarget' | 'fieldMultiplier' | 'spaceWarp' | 'hazard' | 'reentry'
  | 'launchLanes' | 'reflex' | 'timeWarp' | 'missionAccept' | 'missionTarget' | 'tilt'
  | 'extraBall' | 'bonusLane' | 'returnLane' | 'outLane' | 'kicker' | 'replay'
  | 'hyperspace' | 'hyperspaceKickout' | 'blackHole' | 'escape' | 'wormhole'
  | 'spaceWarpTarget' | 'medal' | 'maelstrom' | 'deployment' | 'booster'
  | 'rank' | 'progress' | 'redeploy' | 'gravity' | 'wormholeExit' | 'flag' | 'deploymentArrow' | 'missionArrow' | 'centerPost'
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

const along = (from: Vec2, to: Vec2, t: number): Vec2 => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
const rampLine = (t: number) => along([-0.95, 1.2], [-1.52, 0.4], t)
const row = (light: LightKey, center: Vec2, color: string, size = 0.075): Insert[] =>
  [-1, 0, 1].map((offset, index) => ({ light, index, x: center[0] + offset * 0.2, z: center[1] - offset * 0.104, shape: 'circle' as const, size, color }))
const RAMP_MOUTH: Vec2 = [-1.52, 0.2]

export const INSERTS: readonly Insert[] = [
  { light: 'centerPost', x: CENTER_POST.x, z: CENTER_POST.z - .25, shape: 'circle', size: .07, color: '#ff4141' },
  // Blue mission arrows follow the current objective, including each Secret wormhole.
  ...([[-1.15, .9, -1.52, .2], [.65, -4.1, .65, -4.8], [.35, -1.4, .2, -3],
    [-.45, -.7, -.18, -1.34], [-2.3, -2.1, -2.78, -2.95], [2, -2.3, 2.55, -3.2],
    [1.62, -.85, 2.05, -4.65], [-1.25, -.5, -1.7, -1], [-2.96, .55, -3.22, -.5],
    [-3.0, -3.75, -3.22, -4.2], [-2.0, -4.6, -2.55, -5.25], [-3.15, 2.9, -3.19, 3.6],
    [2.45, 2.7, 2.55, 3.6], [-2.4, 1.8, -2.8, .3], [-1.95, -2.8, -1.6, -3],
    [1.65, -3.5, 2, -3.65], [1.65, 2.0, 2.05, 1.9], [1.95, -1.65, 2.7, -3.2],
    [-1.2, 3.6, -1.8, 3.0]] as const).map(([x, z, tx, tz], index): Insert => ({light: 'missionArrow', index, x, z, toward: [tx, tz], shape: 'arrow', size: .1, color: '#4197ff'})),
  { light: 'gravity', x: GRAVITY_WELL.x, z: GRAVITY_WELL.z, shape: 'circle', size: .15, color: '#4d8bff' },
  ...WORMHOLES.map((w, index): Insert => ({light: 'wormholeExit', index, x: w.x, z: w.z + .4, shape: 'arrow', size: .12, color: '#ffffff', toward: [w.x, w.z]})),
  ...SPINNERS.map((s, index): Insert => ({light: 'flag', index, x: (s.x0 + s.x1) / 2, z: s.z + .25, shape: 'circle', size: .065, color: '#ffcf3a'})),
  ...Array.from({length: 9}, (_, index): Insert => { const a = Math.PI + index * Math.PI / 8; return {light: 'deploymentArrow', index, x: Math.cos(a) * 3.25, z: -3.8 + Math.sin(a) * 2.25, shape: 'arrow', size: .08, color: '#ffcf3a'} }),
  // Left lane of arrows leading to the launch ramp: 10, 11, 13, 12, 14.
  ...ROLLOVERS.slice(9, 15).map((r, index): Insert => ({ light: 'fuel', index, x: r.x, z: r.z, shape: 'circle', size: .09, color: index === 5 ? '#4d8bff' : '#ffcf3a' })),
  ...row('launchLanes', rampLine(0.56), '#3ad7ff'),
  { light: 'timeWarp', x: rampLine(0.69)[0], z: rampLine(0.69)[1], shape: 'arrow', size: 0.15, color: '#59ff8c', toward: RAMP_MOUTH },
  { light: 'reflex', x: rampLine(0.82)[0], z: rampLine(0.82)[1], shape: 'arrow', size: 0.16, color: '#ff8c2a', toward: RAMP_MOUTH },
  { light: 'missionAccept', x: rampLine(0.96)[0], z: rampLine(0.96)[1], shape: 'arrow', size: 0.2, color: '#ff3b3b', toward: RAMP_MOUTH },
  // Upper left: fuel targets (1), field multiplier (4), space warp rollover (5), hazard bank (6).
  ...TARGETS.slice(0, 3).map((t, index): Insert => ({ light: 'fuelTarget', index, x: t.x + 0.3, z: t.z + 0.24, shape: 'circle', size: 0.06, color: '#ffcf3a' })),
  ...Array.from({length: 4}, (_, index): Insert => ({light: 'fieldMultiplier', index, x: -1.5 + index * .2, z: -3.97, shape: 'circle', size: .065, color: '#ffcf3a'})),
  { light: 'spaceWarp', x: -3.22, z: -2.4, shape: 'arrow', size: 0.12, color: '#b56bff', toward: [-3.22, -4] },
  ...TARGETS.slice(7).map((d, i): Insert => ({ light: 'hazard', index: i, x: d.x + (i >= 3 ? -0.3 : 0.3), z: d.z, shape: 'triangle', size: 0.075, color: '#ff4040', toward: [d.x, d.z] })),
  // Mission targets (16), tilt (17), extra ball (18, 46), lower lanes (19, 20, 21, 47, 48), kickers (23, 52).
  ...TARGETS.slice(3, 6).map((t, index): Insert => ({ light: 'missionTarget', index, x: -3.02, z: t.z, shape: 'circle', size: 0.065, color: '#58ff7a' })),
  { light: 'tilt', x: -1.55, z: 2.28, shape: 'cross', size: 0.15, color: '#ff2a2a' },
  { light: 'extraBall', x: -1.25, z: 3.0, shape: 'circle', size: 0.1, color: '#ff9f1a' },
  { light: 'extraBall', x: 0.75, z: 3.0, shape: 'circle', size: 0.1, color: '#ff9f1a' },
  { light: 'outLane', index: 0, x: -3.19, z: 3.15, shape: 'triangle', size: 0.08, color: '#ff3b3b', toward: [-3.19, 4] },
  { light: 'bonusLane', x: -2.565, z: 2.55, shape: 'triangle', size: 0.075, color: '#ffcf3a', toward: [-2.565, 4] },
  { light: 'returnLane', index: 0, x: -2.565, z: 3.85, shape: 'triangle', size: 0.075, color: '#3ad7ff', toward: [-2.565, 5] },
  { light: 'returnLane', index: 1, x: 2.0, z: 2.85, shape: 'triangle', size: 0.075, color: '#3ad7ff', toward: [2.0, 4] },
  { light: 'outLane', index: 1, x: 2.55, z: 3.15, shape: 'triangle', size: 0.08, color: '#ff3b3b', toward: [2.55, 4] },
  { light: 'kicker', index: 0, x: -3.19, z: 4.05, shape: 'arrow', size: 0.12, color: '#ff4848', toward: [-3.19, 2] },
  { light: 'kicker', index: 1, x: 2.55, z: 4.05, shape: 'arrow', size: 0.12, color: '#ff4848', toward: [2.55, 2] },
  // Replay (24) and re-deploy (53).
  { light: 'replay', x: -0.95, z: 3.62, shape: 'rect', size: 0.12, color: '#4d8bff' },
  { light: 'redeploy', x: 0.45, z: 3.62, shape: 'rect', size: 0.12, color: '#58ff7a' },
  // Re-entry lane lights (26) and the kickout / wormhole halos (3, 9, 27, 28, 41, 42).
  ...[0.05, 0.65, 1.25].map((x, index): Insert => ({ light: 'reentry', index, x, z: -5.02, shape: 'circle', size: 0.075, color: '#ffe066' })),
  ...SAUCERS.map((s): Insert => ({ light: s.kind === 'hyperspace' ? 'hyperspaceKickout' : s.kind, x: s.x, z: s.z, shape: 'ring', size: s.kind === 'hyperspace' ? 0.39 : 0.29, color: s.kind === 'hyperspace' ? '#b56bff' : s.kind === 'blackHole' ? '#ff9f1a' : '#3ad7ff' })),
  ...WORMHOLES.map((w, index): Insert => ({ light: 'wormhole', index, x: w.x, z: w.z, shape: 'ring', size: 0.32, color: w.color })),
  // Right side: hyperspace (31), space warp target (34), medals (35), reflex (36), time warp (37), maelstrom (38).
  ...Array.from({ length: 4 }, (_, index): Insert => {
    const [x, z] = along([1.95, -1.45], [2.2, -2.88], index / 3)
    return { light: 'hyperspace', index, x, z, shape: 'circle', size: 0.075, color: '#c46bff' }
  }),
  { light: 'spaceWarpTarget', x: 1.45, z: -1.62, shape: 'circle', size: 0.065, color: '#b56bff' },
  ...DROPS.slice(3, 6).map((t, index): Insert => ({ light: 'medal', index, x: t.x, z: t.z + 0.32, shape: 'circle', size: 0.07, color: '#ffd23f' })),
  { light: 'reflex', index: 1, x: 1.55, z: -0.75, shape: 'arrow', size: 0.14, color: '#ff8c2a', toward: [2.05, -4.65] },
  { light: 'timeWarp', x: 1.35, z: -0.33, shape: 'arrow', size: 0.14, color: '#59ff8c', toward: [2.05, -4.65] },
  { light: 'maelstrom', x: 1.12, z: 0.1, shape: 'arrow', size: 0.15, color: '#3ad7ff', toward: [GRAVITY_WELL.x, GRAVITY_WELL.z] },
  // Deployment lights (39) in the chute and booster target lights (40).
  ...Array.from({ length: 6 }, (_, index): Insert => ({ light: 'deployment', index, x: SERVE.x, z: 4.25 - index * 0.62, shape: 'triangle', size: 0.08, color: '#ff8c2a', toward: [SERVE.x, -6] })),
  ...Array.from({length: 4}, (_, index): Insert => ({ light: 'booster', index, x: 2.38, z: -.05 - index * .34, shape: 'circle', size: 0.065, color: '#3ad7ff' })),
  // Rank lights (44) and progress lights (45).
  ...Array.from({ length: 9 }, (_, index): Insert => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 9
    return { light: 'rank', index, x: GRAVITY_WELL.x + Math.cos(angle) * .72, z: GRAVITY_WELL.z + Math.sin(angle) * .72, shape: 'circle', size: 0.085, color: '#d6a923' }
  }),
  ...Array.from({ length: 18 }, (_, index): Insert => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 18
    return { light: 'progress', index, x: GRAVITY_WELL.x + Math.cos(angle) * 1.13, z: GRAVITY_WELL.z + Math.sin(angle) * 1.13, shape: 'circle', size: 0.065, color: '#2855b7' }
  }),
]
