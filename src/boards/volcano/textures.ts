import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { ARC_SEGMENTS, INSERTS, LAVA, MAGMA_CHAMBER, PRESSURE_LANE, ROLLOVERS, SLINGS, TABLE, type Vec2 } from './layout'

const SCALE = 300
const WIDTH = (TABLE.right - TABLE.left) * SCALE
const HEIGHT = (TABLE.bottom - TABLE.top) * SCALE

/** Seeded so the lava field is identical on every load. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

function texture(canvas: HTMLCanvasElement) {
  const result = new CanvasTexture(canvas)
  result.colorSpace = SRGBColorSpace
  result.anisotropy = 8
  return result
}

/** The printed playfield: cooled basalt split by glowing lava, with an erupting cone at its heart. */
export function createVolcanoPlayfield() {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH; canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  const random = seeded(1815)
  const x = (v: number) => (v - TABLE.left) * SCALE
  const z = (v: number) => (v - TABLE.top) * SCALE
  const s = (v: number) => v * SCALE
  const path = (points: readonly Vec2[]) => {
    ctx.beginPath(); points.forEach(([a, b], i) => i ? ctx.lineTo(x(a), z(b)) : ctx.moveTo(x(a), z(b)))
  }
  const polygon = (points: readonly Vec2[], fill: string | CanvasGradient, stroke = '#120c0b', width = .025) => {
    path(points); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = s(width); ctx.stroke()
  }
  const circle = (a: number, b: number, r: number, fill: string | CanvasGradient, stroke = '#120c0b') => {
    ctx.beginPath(); ctx.arc(x(a), z(b), s(r), 0, Math.PI * 2)
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = s(.025); ctx.stroke()
  }
  /** A glowing molten line: dark crust edge, orange body, yellow-white core. */
  const glow = (points: readonly Vec2[], width: number) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const [color, scale, blur] of [['#2a0904', 1.9, 0], ['#d2370f', 1.2, 22], ['#ff9a2e', .65, 10], ['#ffe9a6', .22, 0]] as const) {
      path(points); ctx.strokeStyle = color; ctx.lineWidth = s(width * scale)
      ctx.shadowColor = '#ff5a1f'; ctx.shadowBlur = blur; ctx.stroke()
    }
    ctx.shadowBlur = 0
  }
  const wander = (start: Vec2, steps: number, stepZ: number, spread: number): Vec2[] => {
    const points: Vec2[] = [start]
    let [px, pz] = start
    for (let i = 0; i < steps; i++) { px += (random() - .5) * spread; pz += stepZ * (.6 + random() * .8); points.push([px, pz]) }
    return points
  }

  // Cooled basalt: charcoal with a deep ember glow rising from the flipper end.
  const base = ctx.createLinearGradient(0, 0, 0, HEIGHT)
  base.addColorStop(0, '#16100f'); base.addColorStop(.45, '#1f1412'); base.addColorStop(.8, '#2b140e'); base.addColorStop(1, '#3a160b')
  ctx.fillStyle = base; ctx.fillRect(0, 0, WIDTH, HEIGHT)
  // Basalt plates: irregular polygons with faint cracked borders.
  for (let i = 0; i < 70; i++) {
    const cx = -3.4 + random() * 6.8, cz = -6 + random() * 11.6, r = .25 + random() * .35
    const plate: Vec2[] = Array.from({ length: 6 }, (_, j) => {
      const a = j / 6 * Math.PI * 2 + random() * .4
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r * .8]
    })
    polygon(plate, `rgba(${40 + random() * 18},${28 + random() * 10},${24 + random() * 8},.55)`, '#0d0807', .012)
  }
  // Hairline lava cracks across the whole field.
  for (let i = 0; i < 26; i++) {
    const points = wander([-3.3 + random() * 6.6, -5.8 + random() * 10], 9, .22, .5)
    path(points); ctx.strokeStyle = '#8f2a10'; ctx.lineWidth = s(.012 + random() * .01)
    ctx.shadowColor = '#ff5a1f'; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0
  }
  // Ash speckle drifting from the plume.
  for (let i = 0; i < 160; i++) circle(-3.3 + random() * 6.6, -6 + random() * 7, .004 + random() * .008, '#7c706a', '#7c706a')

  // Cross-section of the volcano: the cone rises from the vent field to the caldera,
  // with the magma chamber at its heart and a glowing conduit up to the crater.
  const coneBase = ctx.createLinearGradient(0, z(-4.2), 0, z(0.6))
  coneBase.addColorStop(0, '#4a2a22'); coneBase.addColorStop(1, '#22140f')
  polygon([[-2.85, 0.6], [-1.5, -2.2], [-0.75, -3.75], [-0.45, -4.1], [0.05, -4.1], [0.35, -3.75], [1.05, -2.2], [1.85, 0.6]], coneBase, '#120a08', .04)
  // Strata bands across the cone.
  for (let i = 0; i < 5; i++) {
    const bz = -3.2 + i * .75, half = .55 + i * .38
    ctx.beginPath(); ctx.moveTo(x(-.2 - half), z(bz + .08)); ctx.quadraticCurveTo(x(-.2), z(bz - .18), x(-.2 + half), z(bz + .08))
    ctx.strokeStyle = 'rgba(120,70,50,.45)'; ctx.lineWidth = s(.03); ctx.stroke()
  }
  glow([[MAGMA_CHAMBER.x, MAGMA_CHAMBER.z - .5], [-.22, -2.6], [-.18, -3.1], [-.2, -3.45]], .09)
  glow([[-.2, -3.45], [-.55, -3.9], [-1.1, -3.4], [-1.55, -2.5], [-2.05, -1.0], [-2.35, .3]], .045)
  glow([[-.2, -3.45], [.25, -3.85], [.75, -3.0], [1.05, -1.7], [1.4, -.2], [1.6, .6]], .04)
  // Ash plume billowing into the upper corners beside the caldera.
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1, r = random()
    const cx = side * (1.5 + r * 1.2) - .1, cz = -5.2 + random() * 1.4 - r * .4
    const puff = ctx.createRadialGradient(x(cx), z(cz), 0, x(cx), z(cz), s(.3))
    puff.addColorStop(0, 'rgba(110,98,92,.5)'); puff.addColorStop(1, 'rgba(60,50,46,0)')
    ctx.fillStyle = puff; ctx.beginPath(); ctx.arc(x(cx), z(cz), s(.3), 0, Math.PI * 2); ctx.fill()
  }
  // Lava bombs arcing out of the crater.
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1, bx = side * (.8 + random() * 1.5), bz = -4.4 + random() * 1.2
    ctx.beginPath(); ctx.moveTo(x(-.2), z(-3.5)); ctx.quadraticCurveTo(x(bx * .5), z(bz - 1), x(bx), z(bz))
    ctx.strokeStyle = 'rgba(255,138,31,.3)'; ctx.lineWidth = s(.014); ctx.stroke()
    circle(bx, bz, .035 + random() * .025, '#ff8a1f', '#5c1606')
  }
  // Lava rivers from the cone's foot into the flipper pool.
  glow(wander([-2.35, .3], 6, .5, .2), .055)
  glow(wander([1.6, .6], 5, .45, .18), .05)
  // The pressure chute glows up the right orbit.
  glow([[PRESSURE_LANE.x, PRESSURE_LANE.bottom], [PRESSURE_LANE.x, PRESSURE_LANE.top]], .035)
  // Molten pool beneath the flippers.
  const pool = ctx.createRadialGradient(x(-.25), z(5.1), 0, x(-.25), z(5.1), s(1.6))
  pool.addColorStop(0, '#ffd27a'); pool.addColorStop(.25, '#ff8a1f'); pool.addColorStop(.6, '#b8321a'); pool.addColorStop(1, 'rgba(58,22,11,0)')
  polygon([[-1.75, 5.85], [-2.3, 4.55], [-1.2, 4.85], [-1.3, 3.5], [-.55, 4.5], [-.25, 3.75], [.05, 4.5], [.75, 3.5], [.65, 4.9], [1.8, 4.55], [1.2, 5.85]], pool, '#3a1208', .04)
  // Crust islands floating on the pool.
  for (let i = 0; i < 14; i++) {
    const cx = -1.2 + random() * 1.9, cz = 4.6 + random() * 1
    polygon(Array.from({ length: 5 }, (_, j): Vec2 => { const a = j / 5 * Math.PI * 2; return [cx + Math.cos(a) * .07, cz + Math.sin(a) * .05] }), '#3b1d14', '#1a0b07', .01)
  }

  // The magma chamber: a molten disc with the rank and progress lamps ringed around it.
  const { x: mx, z: mz, radius } = MAGMA_CHAMBER
  const chamber = ctx.createRadialGradient(x(mx), z(mz), 0, x(mx), z(mz), s(radius))
  chamber.addColorStop(0, '#fff1b0'); chamber.addColorStop(.28, '#ffb347'); chamber.addColorStop(.6, '#d2370f'); chamber.addColorStop(1, '#3a120a')
  circle(mx, mz, radius, chamber, '#120a08')
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2
    ctx.beginPath()
    for (let j = 0; j < 5; j++) {
      const r = .3 + j * .12, angle = a + (random() - .5) * .2
      const px = x(mx + Math.cos(angle) * r), pz = z(mz + Math.sin(angle) * r)
      if (!j) ctx.moveTo(px, pz); else ctx.lineTo(px, pz)
    }
    ctx.strokeStyle = '#4a170b'; ctx.lineWidth = s(.02); ctx.stroke()
  }
  circle(mx, mz, .11, '#fff4d6', '#ff8a1f')
  for (let i = 0; i < 18; i++) {
    const a = -Math.PI / 2 + i / 18 * Math.PI * 2
    circle(mx + Math.cos(a) * 1.13, mz + Math.sin(a) * 1.13, .065, '#3a120a')
  }

  // Obsidian rollover switches with brass indicator inserts.
  ROLLOVERS.filter(r => r.kind !== 'crater' && r.kind !== 'pressure').forEach(r => {
    ctx.fillStyle = '#d8cbb8'; ctx.fillRect(x(r.x - .055), z(r.z - .15), s(.11), s(.3))
    ctx.fillStyle = '#1a1110'; ctx.fillRect(x(r.x - .028), z(r.z - .125), s(.056), s(.25))
    circle(r.x, r.z - .31, .105, '#a2601a')
  })
  // Basalt slings, each split by a molten crack.
  for (const points of [SLINGS.left, SLINGS.right]) {
    polygon(points, '#2a1a16', '#ff5a1f', .07)
    const [top, , inner] = points
    glow([[top[0], top[1] + .25], [top[0] + (inner[0] - top[0]) * .35, top[1] + .7], [top[0] + (inner[0] - top[0]) * .2, top[1] + 1.0], [inner[0], inner[1] - .22]], .025)
  }

  // Cabinet apron and the magma chute.
  ctx.fillStyle = '#0f0a09'; ctx.fillRect(0, z(5.48), WIDTH, s(.82))
  polygon([[-1.65, 5.48], [-1.18, 5.93], [.9, 5.93], [1.33, 5.48]], '#7a2410')
  ctx.fillStyle = '#3a1f17'; ctx.fillRect(x(2.85), z(-2.1), s(.65), s(8.1))
  ctx.fillStyle = '#140b09'; ctx.fillRect(x(2.91), z(-2.1), s(.15), s(8.1))
  for (let i = 0; i < 6; i++) polygon([[2.85, 4.1 - i * 1.3], [3.5, 3.8 - i * 1.3], [3.5, 3.58 - i * 1.3], [2.85, 3.87 - i * 1.3]], '#ff8a1f')
  ctx.font = 'italic 800 52px Arial'; ctx.fillStyle = '#ff6a1f'
  ctx.fillText('ERUPTION', x(-3.28), z(6.0)); ctx.fillText('VOLCANO', x(1.78), z(6.0))
  // Mask the cabinet wood outside the summit crown.
  polygon([[-3.5, -6.3], [3.5, -6.3], ...ARC_SEGMENTS.slice().reverse().map(segment => segment.b), ARC_SEGMENTS[0].a], '#0e0908', '#0e0908')
  // Ember chevrons climb the outside orbit.
  ARC_SEGMENTS.filter((_, i) => i % 9 === 3).forEach(segment => {
    const a = segment.a
    polygon([[a[0] - .08, a[1] - .23], [a[0] + .08, a[1] - .23], [a[0], a[1] - .08]], '#c4541a')
  })
  // Recessed lamp sockets remain visible when their lights are off.
  INSERTS.filter(i => i.shape === 'circle').forEach(i => circle(i.x, i.z, i.size + .025, '#5a2a12'))
  return texture(canvas)
}

/** Flame burst emblem for the vent and fountain bumper caps. */
export function createFlameCapTexture(color: string) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const back = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  back.addColorStop(0, '#fff4d6'); back.addColorStop(1, '#ffd9a0')
  ctx.fillStyle = back; ctx.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6
    const r = i % 2 ? 104 : 126
    ctx.beginPath(); ctx.moveTo(128 + Math.cos(a - .26) * 54, 128 + Math.sin(a - .26) * 54)
    ctx.quadraticCurveTo(128 + Math.cos(a - .1) * r * .8, 128 + Math.sin(a - .1) * r * .8, 128 + Math.cos(a) * r, 128 + Math.sin(a) * r)
    ctx.quadraticCurveTo(128 + Math.cos(a + .1) * r * .8, 128 + Math.sin(a + .1) * r * .8, 128 + Math.cos(a + .26) * 54, 128 + Math.sin(a + .26) * 54)
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
  }
  ctx.beginPath(); ctx.arc(128, 128, 56, 0, Math.PI * 2); ctx.fillStyle = '#fff1c2'; ctx.fill()
  ctx.lineWidth = 6; ctx.strokeStyle = color; ctx.stroke()
  const core = ctx.createRadialGradient(128, 128, 0, 128, 128, 42)
  core.addColorStop(0, '#ffe14d'); core.addColorStop(1, '#c4280f')
  ctx.beginPath(); ctx.arc(128, 128, 42, 0, Math.PI * 2); ctx.fillStyle = core; ctx.fill()
  return texture(canvas)
}

/** A churning lava swirl for the tubes. */
export function createLavaSwirlTexture(inner: string, outer: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
  g.addColorStop(0, '#000000'); g.addColorStop(0.2, '#120604'); g.addColorStop(0.7, outer); g.addColorStop(1, '#120604')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 512)
  ctx.translate(256, 256)
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath()
    for (let i = 0; i <= 120; i++) {
      const t = i / 120
      const angle = arm * Math.PI * 2 / 3 + t * 5.2
      const radius = 24 + t * 226
      if (i === 0) ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
      else ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    }
    ctx.strokeStyle = inner
    ctx.lineWidth = 26
    ctx.globalAlpha = 0.8
    ctx.stroke()
    ctx.strokeStyle = '#fff1c2'
    ctx.lineWidth = 6
    ctx.stroke()
  }
  const result = texture(canvas)
  result.wrapS = result.wrapT = RepeatWrapping
  return result
}

/** Rim ramp floor: molten chevrons flowing downhill. */
export function createLavaRampTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 2048
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#5a1d0f'; ctx.fillRect(0, 0, 256, 2048)
  for (let y = 0; y < 2048; y += 128) {
    ctx.beginPath(); ctx.moveTo(0, y + 90); ctx.lineTo(128, y); ctx.lineTo(256, y + 90)
    ctx.lineTo(256, y + 128); ctx.lineTo(128, y + 42); ctx.lineTo(0, y + 128); ctx.closePath()
    ctx.fillStyle = LAVA.orange; ctx.fill()
    ctx.beginPath(); ctx.moveTo(40, y + 100); ctx.lineTo(128, y + 30); ctx.lineTo(216, y + 100)
    ctx.strokeStyle = '#ffe9a6'; ctx.lineWidth = 6; ctx.stroke()
  }
  const result = texture(canvas)
  // Ribbon UVs are distances; scale the artwork to the actual ramp length.
  result.repeat.y = .12
  return result
}
