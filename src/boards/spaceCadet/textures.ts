import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { ARC_SEGMENTS, GRAVITY_WELL, INSERTS, ROLLOVERS, SLINGS, TABLE, type Vec2 } from './layout'

const SCALE = 300
const WIDTH = (TABLE.right - TABLE.left) * SCALE
const HEIGHT = (TABLE.bottom - TABLE.top) * SCALE

/** Seeded so the starfield is identical on every load. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

/** The printed playfield, drawn locally in the style of the classic space table. */
export function createCadetPlayfield() {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH; canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  const random = seeded(4242)
  const x = (v: number) => (v - TABLE.left) * SCALE
  const z = (v: number) => (v - TABLE.top) * SCALE
  const s = (v: number) => v * SCALE
  const polygon = (points: readonly Vec2[], fill: string | CanvasGradient, stroke = '#13172e', width = .025) => {
    ctx.beginPath(); points.forEach(([a, b], i) => i ? ctx.lineTo(x(a), z(b)) : ctx.moveTo(x(a), z(b)))
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = s(width); ctx.stroke()
  }
  const circle = (a: number, b: number, r: number, fill: string | CanvasGradient, stroke = '#171928') => {
    ctx.beginPath(); ctx.arc(x(a), z(b), s(r), 0, Math.PI * 2)
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = s(.025); ctx.stroke()
  }
  // Muted indigo screen print with branching sea-green electrical veins.
  const base = ctx.createLinearGradient(0, 0, 0, HEIGHT)
  base.addColorStop(0, '#171735'); base.addColorStop(.6, '#252640'); base.addColorStop(1, '#282841')
  ctx.fillStyle = base; ctx.fillRect(0, 0, WIDTH, HEIGHT)
  for (let i = 0; i < 24; i++) {
    let px = -3.4 + random() * 6.7, pz = -5.8 + random() * 10.5
    ctx.beginPath(); ctx.moveTo(x(px), z(pz))
    for (let j = 0; j < 19; j++) {
      px += (random() - .5) * .5; pz += .1 + random() * .22
      ctx.lineTo(x(px), z(pz))
      if (j % 4 === 0) {
        ctx.lineTo(x(px + .18), z(pz + .08)); ctx.lineTo(x(px + .25), z(pz + .35)); ctx.moveTo(x(px), z(pz))
      }
    }
    ctx.strokeStyle = '#486f7b'; ctx.lineWidth = s(.023 + random() * .016); ctx.stroke()
  }
  for (let i = 0; i < 90; i++) circle(-3.3 + random() * 6.5, -6 + random() * 5, .004 + random() * .007, '#81899e', '#81899e')
  // Rocket and launch streak on the left, meteor field on the right.
  polygon([[-2.56,-1.35],[-2.07,-1.61],[-1.5,.58],[-1.76,.75],[-1.7,1.0],[-1.99,.84]], '#b36cba', '#99d8e0', .045)
  drawShuttle(ctx, x(-1.5), z(-1.95), s(.8), -.35)
  for (let i = 0; i < 5; i++) {
    const cx = .82 + Math.sin(i * 2) * .23, cz = -2.0 + i * .38
    const points: Vec2[] = Array.from({length: 13}, (_, j) => {
      const angle = j / 13 * Math.PI * 2, r = .18 + random() * .12
      return [cx + Math.cos(angle) * r, cz + Math.sin(angle) * r]
    })
    polygon(points, '#a09b88', '#90bed0', .05)
    for (let j = 0; j < 7; j++) circle(cx + (random() - .5) * .26, cz + (random() - .5) * .25, .014 + random() * .02, '#505553')
  }
  polygon([[.58,1.0],[.66,.66],[.5,.73],[.79,.21],[.66,.23],[1.0,-.25],[.88,-.26],[1.62,-1.04],[1.33,-.26],[1.46,-.31],[1.09,.27],[1.22,.2],[.91,.9],[.72,1.15]], '#c73647', '#a4dbeb', .055)
  for (let i = 0; i < 3; i++) polygon([[.83+i*.18,.65-i*.43],[1.02+i*.18,.35-i*.43],[1.04+i*.18,.69-i*.43]], '#163d80')
  // Orange impact cloud behind the launch trajectory.
  const cloud: Vec2[] = Array.from({length: 30}, (_, i) => {
    const a = i / 30 * Math.PI * 2, r = .45 + random() * .16
    return [-.58 + Math.cos(a)*r, -.25 + Math.sin(a)*r]
  })
  polygon(cloud, '#b35449', '#9dc9d8', .045)
  for (let i = 0; i < 100; i++) circle(-.95 + random()*.7, -.63+random()*.75, .01, '#ca7760', '#ca7760')
  // Large cyan energy disc, with blue rank lamps around its perimeter.
  const well = ctx.createRadialGradient(x(GRAVITY_WELL.x), z(GRAVITY_WELL.z), 0, x(GRAVITY_WELL.x), z(GRAVITY_WELL.z), s(GRAVITY_WELL.radius))
  well.addColorStop(0, '#65ebee'); well.addColorStop(.48, '#579fae'); well.addColorStop(1, '#655653')
  circle(GRAVITY_WELL.x, GRAVITY_WELL.z, GRAVITY_WELL.radius, well)
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2
    ctx.beginPath()
    for (let j = 0; j < 5; j++) {
      const r = .35 + j * .11, angle = a + (random() - .5) * .16
      const px = x(GRAVITY_WELL.x + Math.cos(angle)*r), pz = z(GRAVITY_WELL.z + Math.sin(angle)*r)
      if (!j) ctx.moveTo(px,pz); else ctx.lineTo(px,pz)
    }
    ctx.strokeStyle = '#493c3f'; ctx.lineWidth = s(.018); ctx.stroke()
  }
  circle(GRAVITY_WELL.x, GRAVITY_WELL.z, .105, '#c6272e')
  for (let i = 0; i < 18; i++) {
    const a = -Math.PI / 2 + i / 18 * Math.PI * 2
    circle(GRAVITY_WELL.x+Math.cos(a)*1.13, GRAVITY_WELL.z+Math.sin(a)*1.13, .065, '#19498e')
  }
  // Ivory rollover switches with brass indicator inserts.
  ROLLOVERS.filter(r => r.kind !== 'engine' && r.kind !== 'fuel').forEach(r => {
    ctx.fillStyle = '#eef0d4'; ctx.fillRect(x(r.x-.055),z(r.z-.15),s(.11),s(.3))
    ctx.fillStyle = '#222b37'; ctx.fillRect(x(r.x-.028),z(r.z-.125),s(.056),s(.25))
    circle(r.x, r.z-.31, .105, '#b58917')
  })
  for (const points of [SLINGS.left, SLINGS.right]) {
    polygon(points, '#20294a', '#b53e49', .08)
    const [top,, inner] = points
    for (let n = 0; n < 3; n++) {
      ctx.beginPath(); ctx.moveTo(x(top[0]),z(top[1]+.13+n*.23))
      ctx.lineTo(x(top[0]+(inner[0]-top[0])*.3),z(top[1]+.4+n*.25))
      ctx.lineTo(x(top[0]+(inner[0]-top[0])*.18),z(top[1]+.57+n*.25))
      ctx.lineTo(x(inner[0]),z(inner[1]-.2))
      ctx.strokeStyle = '#9adbe9'; ctx.lineWidth=s(.026); ctx.shadowColor='#64d5ff'; ctx.shadowBlur=12; ctx.stroke(); ctx.shadowBlur=0
    }
  }
  // The characteristic purple three-pronged flare around the flippers.
  polygon([[-1.7,5.85],[-2.35,4.53],[-1.09,4.91],[-1.38,3.37],[-.49,4.56],[-.25,3.81],[.03,4.56],[.65,3.36],[.63,4.96],[1.86,4.54],[1.18,5.85]], '#9f69ae', '#362145', .045)
  polygon([[-.62,4.57],[-1.17,3.63],[-.77,4.96],[-.34,5.52],[.32,4.9],[.52,3.65],[-.04,4.58],[-.25,4.15]], '#5743a2', '#453565')
  // Cabinet apron and deployment lane.
  ctx.fillStyle = '#141619'; ctx.fillRect(0,z(5.48),WIDTH,s(.82))
  polygon([[-1.65,5.48],[-1.18,5.93],[.9,5.93],[1.33,5.48]], '#986ba8')
  ctx.fillStyle = '#685345'; ctx.fillRect(x(2.85), z(-2.1), s(.65), s(8.1))
  ctx.fillStyle = '#1b2024'; ctx.fillRect(x(2.91), z(-2.1), s(.15), s(8.1))
  for (let i = 0; i < 6; i++) polygon([[2.85,4.1-i*1.3],[3.5,3.8-i*1.3],[3.5,3.58-i*1.3],[2.85,3.87-i*1.3]], '#c5c928')
  ctx.font = 'italic 700 48px Arial'; ctx.fillStyle='#c74c4a'
  ctx.fillText('CINEMATRONICS', x(-3.28),z(6.0)); ctx.fillText('MAXIS',x(2.15),z(6.0))
  // Mask the wood outside the curved playfield crown.
  polygon([[-3.5,-6.3],[3.5,-6.3],...ARC_SEGMENTS.slice().reverse().map(segment=>segment.b), ARC_SEGMENTS[0].a], '#18161a', '#18161a')
  // Gold arrows along the outside orbit.
  ARC_SEGMENTS.filter((_,i)=>i%9===3).forEach(segment=>{
    const a=segment.a
    polygon([[a[0]-.08,a[1]-.23],[a[0]+.08,a[1]-.23],[a[0],a[1]-.08]],'#b2972a')
  })
  // Recessed lamp sockets remain visible when their lights are off.
  INSERTS.filter(i => i.shape === 'circle').forEach(i => circle(i.x,i.z,i.size+.025,'#857021'))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 8
  return texture
}

/** Printed instruction cards beneath the apron glass. */
export function createCadetApronTexture(right: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = right ? 700 : 940
  canvas.height = 400
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#10162c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#7783a9'
  ctx.lineWidth = 3
  ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#e9efff'
  ctx.font = '700 52px "Arial", sans-serif'
  ctx.fillText(right ? 'FLIGHT CONTROLS' : 'SPACE CADET', canvas.width / 2, 90)
  ctx.fillStyle = '#b7c7f2'
  ctx.font = '500 30px "Arial", sans-serif'
  const lines = right ? ['A / D  ·  FLIPPERS', 'SPACE  ·  LAUNCH', 'N  ·  NUDGE'] : ['LIGHT TARGETS TO SELECT A MISSION', 'SHOOT THE RAMP TO ACCEPT', 'COMPLETE ORDERS. EARN YOUR RANK.']
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, 170 + i * 62))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function drawShuttle(ctx: CanvasRenderingContext2D, cx: number, cz: number, length: number, rotation: number) {
  ctx.save()
  ctx.translate(cx, cz)
  ctx.rotate(rotation)
  ctx.globalAlpha = 0.55
  const flame = ctx.createLinearGradient(0, length * 0.45, 0, length * 0.95)
  flame.addColorStop(0, '#fff3c4'); flame.addColorStop(0.4, '#ff8c2a'); flame.addColorStop(1, 'rgba(255,60,40,0)')
  ctx.fillStyle = flame
  ctx.beginPath(); ctx.moveTo(-length * 0.08, length * 0.42); ctx.lineTo(0, length * 0.95); ctx.lineTo(length * 0.08, length * 0.42); ctx.fill()
  ctx.fillStyle = '#e8ecf5'
  ctx.strokeStyle = '#1b2350'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, -length * 0.5)
  ctx.quadraticCurveTo(length * 0.09, -length * 0.35, length * 0.09, -length * 0.1)
  ctx.lineTo(length * 0.3, length * 0.32)
  ctx.lineTo(length * 0.3, length * 0.42)
  ctx.lineTo(-length * 0.3, length * 0.42)
  ctx.lineTo(-length * 0.3, length * 0.32)
  ctx.lineTo(-length * 0.09, -length * 0.1)
  ctx.quadraticCurveTo(-length * 0.09, -length * 0.35, 0, -length * 0.5)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#1b2350'
  ctx.fillRect(-length * 0.04, -length * 0.38, length * 0.08, length * 0.07)
  ctx.restore()
}

/** Star emblem for the bumper caps. */
export function createCadetBumperTexture(color: string) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff9df'; ctx.fillRect(0,0,256,256)
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5
    ctx.beginPath(); ctx.moveTo(128+Math.cos(a)*64,128+Math.sin(a)*64)
    ctx.lineTo(128+Math.cos(a-.24)*126,128+Math.sin(a-.24)*126)
    ctx.arc(128,128,126,a-.24,a+.24)
    ctx.closePath(); ctx.fillStyle=color; ctx.fill()
  }
  ctx.beginPath(); ctx.arc(128,128,57,0,Math.PI*2); ctx.fillStyle='#fffef0'; ctx.fill()
  ctx.lineWidth=5; ctx.strokeStyle=color; ctx.stroke()
  ctx.beginPath(); ctx.arc(128,128,44,0,Math.PI*2); ctx.fillStyle='#104992'; ctx.fill()
  const texture = new CanvasTexture(canvas); texture.colorSpace=SRGBColorSpace
  return texture
}

/** A spiral vortex used by the wormholes and the gravity well. */
export function createVortexTexture(inner: string, outer: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
  g.addColorStop(0, '#000000'); g.addColorStop(0.18, '#02030c'); g.addColorStop(0.7, outer); g.addColorStop(1, '#02030c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 512)
  ctx.translate(256, 256)
  for (let arm = 0; arm < 5; arm++) {
    ctx.beginPath()
    for (let i = 0; i <= 120; i++) {
      const t = i / 120
      const angle = arm * Math.PI * 2 / 5 + t * 4.4
      const radius = 30 + t * 220
      const px = Math.cos(angle) * radius
      const pz = Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(px, pz)
      else ctx.lineTo(px, pz)
    }
    ctx.strokeStyle = inner
    ctx.lineWidth = 16
    ctx.globalAlpha = 0.75
    ctx.stroke()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = texture.wrapT = RepeatWrapping
  return texture
}
