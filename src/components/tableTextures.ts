import { CanvasTexture, SRGBColorSpace } from 'three'

const WIDTH = 2048
const HEIGHT = 3540

/** The printed playfield is drawn locally, so the game never waits on image or font services. */
export function createPlayfieldTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  const sx = WIDTH / 6.25
  const sz = HEIGHT / 10.8
  const x = (value: number) => (value + 3.125) * sx
  const z = (value: number) => (value + 5.4) * sz
  const color = { orange: '#ed581e', cream: '#e6ddc8', muted: '#67665e', line: '#343633' }

  ctx.fillStyle = '#141a19'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Fine architectural grid and deterministic flecks give the enamel a tactile grain.
  ctx.strokeStyle = '#202623'
  ctx.lineWidth = 1
  for (let i = 0; i < WIDTH; i += 48) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, HEIGHT); ctx.stroke()
  }
  for (let i = 0; i < HEIGHT; i += 48) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(WIDTH, i); ctx.stroke()
  }
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(224,224,194,.028)' : 'rgba(0,0,0,.07)'
    ctx.fillRect((i * 239.731) % WIDTH, (i * 71.127) % HEIGHT, 1.2, 1.2)
  }

  function line(points: number[][], stroke = color.cream, width = 3) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.beginPath()
    points.forEach(([a, b], i) => i ? ctx.lineTo(x(a), z(b)) : ctx.moveTo(x(a), z(b)))
    ctx.stroke()
  }
  function text(value: string, a: number, b: number, size: number, fill = color.cream, align: CanvasTextAlign = 'left', weight = '600') {
    ctx.fillStyle = fill
    ctx.textAlign = align
    ctx.font = `${weight} ${Math.max(26, size * 4 / 3)}px Arial, sans-serif`
    ctx.fillText(value, x(a), z(b))
  }
  function circle(a: number, b: number, radius: number, stroke: string, width = 2, start = 0, end = Math.PI * 2) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.ellipse(x(a), z(b), radius * sx, radius * sz, 0, start, end)
    ctx.stroke()
  }

  // A deliberately oversized orbital diagram crosses behind the upper play area.
  circle(-.24, -1.88, 2.35, color.muted, 2)
  circle(-.24, -1.88, 2.24, color.cream, 6, .12, 4.65)
  circle(-.24, -1.88, 2.10, color.line, 1)
  circle(-.24, -1.88, 1.84, color.orange, 17, 3.25, 5.27)
  circle(-.24, -1.88, 1.71, color.line, 3)
  circle(-.24, -1.88, 1.31, color.muted, 1)
  for (let i = 0; i < 90; i++) {
    const angle = i * Math.PI * 2 / 90
    const outer = i % 5 === 0 ? 2.5 : 2.43
    line([
      [-.24 + Math.cos(angle) * 2.37, -1.88 + Math.sin(angle) * 2.37],
      [-.24 + Math.cos(angle) * outer, -1.88 + Math.sin(angle) * outer],
    ], i % 5 === 0 ? color.cream : color.muted, i % 5 === 0 ? 3 : 1)
  }

  // The celestial body uses topographic longitude curves instead of an image asset.
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(x(-.24), z(-1.88), sx * 1.12, sz * 1.12, 0, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#a9aaa0'
  ctx.fillRect(x(-1.4), z(-3.05), sx * 2.3, sz * 2.3)
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = '#252f2a'
    ctx.lineWidth = 3 + i % 4
    ctx.beginPath()
    ctx.ellipse(x(-1.17 - i * .045), z(-2.52 + i * .009), sx * (.1 + i * .106), sz * (.27 + i * .093), -.55, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  circle(-.24, -1.88, 1.13, color.cream, 3)
  line([[-2.8, -1.88], [2.30, -1.88]], '#838678', 1)
  line([[-.24, -4.65], [-.24, .60]], '#838678', 1)

  // Precision registration markings, launch trajectory, and understated captions.
  line([[-2.67, -4.27], [-2.67, -4.68], [-1.8, -4.68]], color.orange, 7)
  text('O R B I T A L', -.27, -4.58, 61, color.cream, 'center', '800')
  text('DEEP SPACE PINBALL DIVISION', -.27, -4.35, 19, color.muted, 'center')
  text('TRAJECTORY / 01', -2.58, -.33, 19, color.cream)
  text('RE-ENTRY VECTOR', .96, -.1, 17, color.muted)
  text('N  35°  28′', -2.55, -3.77, 18, color.muted)
  text('E  139°  43′', -2.55, -3.61, 18, color.muted)
  text('HIGH ORBIT', -.24, .47, 29, color.cream, 'center', '700')
  text('LIGHT THREE LANES TO ADVANCE', -.24, .68, 15, color.muted, 'center')

  // All high-contrast arrows guide the eye back to the playable flipper area.
  for (let i = 0; i < 3; i++) {
    const yy = 1.00 + i * .34
    line([[-.53, yy], [-.24, yy + .18], [.05, yy]], i === 2 ? color.cream : color.orange, 12)
  }
  circle(-.24, 2.34, .55, color.line, 3)
  circle(-.24, 2.34, .42, color.orange, 3, -.75, 3.90)
  text('2×', -.24, 2.50, 83, color.cream, 'center', '800')
  text('ORBIT MULTIPLIER', -.24, 3.03, 18, color.muted, 'center')

  // Slingshot panel print stays below the real collision hardware.
  for (const points of [[[-2.35, 1], [-2.35, 2.5], [-1.35, 2.9]], [[2.08, 1], [2.08, 2.5], [1.15, 2.9]]]) {
    ctx.beginPath()
    points.forEach(([a, b], i) => i === 0 ? ctx.moveTo(x(a), z(b)) : ctx.lineTo(x(a), z(b)))
    ctx.closePath()
    ctx.fillStyle = '#613b23'
    ctx.fill()
  }

  // Edge stripes and the launch channel read as manufactured warning graphics.
  line([[2.50, -4.8], [2.50, 4.32]], '#474b41', 2)
  for (let i = 0; i < 20; i++) {
    const b = -.2 + i * .21
    line([[2.70, b], [2.82, b + .12]], color.orange, 4)
  }
  ctx.save()
  ctx.translate(x(2.87), z(-.85))
  ctx.rotate(-Math.PI / 2)
  ctx.font = '700 32px Arial'
  ctx.fillStyle = color.cream
  ctx.fillText('LAUNCH SEQUENCE', 0, 0)
  ctx.restore()
  for (const a of [-2.82, 2.25]) {
    for (let i = 0; i < 22; i++) line([[a, -.2 + i * .15], [a + .13, -.2 + i * .15]], i % 5 ? color.line : color.muted, 2)
  }

  // Bottom apron: typographic hierarchy and crisp technical labels.
  ctx.fillStyle = '#101715'
  ctx.fillRect(x(-3.05), z(4.38), sx * 6.15, sz * 1.1)
  line([[-2.75, 4.46], [2.2, 4.46]], color.orange, 5)
  text('ORBITAL', -2.68, 5.04, 120, color.cream, 'left', '900')
  text('O R B I T A L   S Y S T E M S   /   E S T .   2 0 8 6', -2.64, 5.22, 13, color.muted)
  text('01', 2.02, 5.02, 97, color.orange, 'right', '800')
  text('FLIGHT READY', 2.04, 5.20, 16, color.cream, 'right')

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 16
  return texture
}

export function createBumperTexture(index: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#222924'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = '#f2e7ce'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(128, 128, 111, 0, Math.PI * 2); ctx.stroke()
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * 2 * i / 12
    ctx.beginPath()
    ctx.moveTo(128 + Math.cos(a) * 97, 128 + Math.sin(a) * 97)
    ctx.lineTo(128 + Math.cos(a) * 105, 128 + Math.sin(a) * 105)
    ctx.stroke()
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#eee2c9'
  ctx.font = '800 95px Arial'
  ctx.fillText(`0${index + 1}`, 128, 157)
  ctx.font = '700 15px Arial'
  ctx.fillText('REACTOR', 128, 186)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Shared soft lamp spill; one small texture serves every insert on a table. */
export function createLampHaloTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,.65)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,.24)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** A deliberately faint cabinet-glass reflection, without obscuring ball tracking. */
export function createGlassSheenTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 390, 512, 110)
  gradient.addColorStop(0, 'rgba(255,255,255,0)')
  gradient.addColorStop(.36, 'rgba(255,255,255,0)')
  gradient.addColorStop(.46, 'rgba(205,225,255,.4)')
  gradient.addColorStop(.49, 'rgba(255,255,255,.8)')
  gradient.addColorStop(.52, 'rgba(255,255,255,0)')
  gradient.addColorStop(.77, 'rgba(255,255,255,0)')
  gradient.addColorStop(.82, 'rgba(205,225,255,.25)')
  gradient.addColorStop(.88, 'rgba(255,255,255,0)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 512, 512)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
