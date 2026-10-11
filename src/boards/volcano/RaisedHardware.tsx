import { useFrame } from '@react-three/fiber'
import type { MeshStandardMaterial } from 'three'
import type { VolcanoGame } from './game'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, DoubleSide, ExtrudeGeometry, Shape, TubeGeometry, Vector3 } from 'three'
import { DECK_OUTLINE, DECK_RAILS, DECK_Y, DROP_FACE, DROPS, HABITRAIL_PATH, LAVA, RAMP_PATH, RAMP_WIDTH, RIM_LANES, type Vec2, type Vec3 } from './layout'
import { createLavaRampTexture } from './textures'

function polygonGeometry(points: readonly Vec2[], depth: number) {
  const shape = new Shape()
  points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z))
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .025, bevelThickness: .015, bevelSegments: 2 })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** A solid elevated ribbon with side walls; the underside is open to ground balls. */
function ribbon(path: readonly Vec3[], width: number, wallHeight = .22) {
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = []
  const rims: Vector3[][] = [[], []]
  let distance = 0
  path.forEach(([x, y, z], i) => {
    if (i) distance += Math.hypot(x - path[i - 1][0], z - path[i - 1][2])
    const before = path[Math.max(0, i - 1)], after = path[Math.min(path.length - 1, i + 1)]
    const dx = after[0] - before[0], dz = after[2] - before[2], length = Math.hypot(dx, dz)
    const sx = -dz / length * width / 2, sz = dx / length * width / 2
    vertices.push(x - sx, y + .065, z - sz, x + sx, y + .065, z + sz)
    uvs.push(0, distance / width, 1, distance / width)
    rims[0].push(new Vector3(x - sx, y + .065 + wallHeight, z - sz))
    rims[1].push(new Vector3(x + sx, y + .065 + wallHeight, z + sz))
    if (i < path.length - 1) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
  })
  const floor = new BufferGeometry()
  floor.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3))
  floor.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2)); floor.setIndex(indices); floor.computeVertexNormals()
  const walls = rims.map(points => {
    const pos: number[] = [], idx: number[] = []
    points.forEach((p, i) => {
      pos.push(p.x, p.y - wallHeight - .05, p.z, p.x, p.y, p.z)
      if (i < points.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    })
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3)); g.setIndex(idx); g.computeVertexNormals(); return g
  })
  const rails = rims.map(p => new TubeGeometry(new CatmullRomCurve3(p), path.length * 2, .023, 8, false))
  return { floor, walls, rails }
}

/** Rim ramp: a molten channel climbing the right side to the caldera. Its floor slowly flows. */
export function RimRamp() {
  const geometry = useMemo(() => ribbon(RAMP_PATH, RAMP_WIDTH), [])
  const texture = useMemo(createLavaRampTexture, [])
  useEffect(() => () => { geometry.floor.dispose(); geometry.walls.forEach(g => g.dispose()); geometry.rails.forEach(g => g.dispose()); texture.dispose() }, [geometry, texture])
  useFrame((_, delta) => { texture.offset.y = (texture.offset.y + delta * .05) % 1 })
  return <group>
    <mesh geometry={geometry.floor} castShadow receiveShadow>
      <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ff6a1f" emissiveIntensity={.55} side={DoubleSide} roughness={.5} toneMapped={false} />
    </mesh>
    {geometry.walls.map((g, i) => <mesh key={i} geometry={g} castShadow receiveShadow><meshStandardMaterial color="#2c1c18" side={DoubleSide} roughness={.7} /></mesh>)}
    {geometry.rails.map((g, i) => <mesh key={i} geometry={g}><meshStandardMaterial color="#b9a89a" metalness={.65} roughness={.3} /></mesh>)}
  </group>
}

/** The raised caldera with its three crater-lane lamps. */
export function CraterRim({ game }: { game: VolcanoGame }) {
  const lamps = useRef<(MeshStandardMaterial | null)[]>([])
  useFrame(() => lamps.current.forEach((m, i) => { if (m) m.emissiveIntensity = game.craterLit[i] ? 2.2 : .05 }))
  const floor = useMemo(() => polygonGeometry(DECK_OUTLINE, .1), [])
  const rails = useMemo(() => DECK_RAILS.map(s => polygonGeometry([s.a, s.b, [s.b[0] + .035, s.b[1] + .015], [s.a[0] + .035, s.a[1] + .015]], .25)), [])
  useEffect(() => () => { floor.dispose(); rails.forEach(g => g.dispose()) }, [floor, rails])
  return <group>
    <mesh geometry={floor} position={[0, DECK_Y - .035, 0]} castShadow receiveShadow><meshStandardMaterial color="#3b2722" roughness={.85} /></mesh>
    {rails.map((g, i) => <mesh key={i} geometry={g} position={[0, DECK_Y, 0]} castShadow><meshStandardMaterial color="#1e1411" roughness={.6} /></mesh>)}
    {RIM_LANES.x.map((x, i) => <group key={x} position={[x, DECK_Y + .095, RIM_LANES.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.08, .105, 24]} /><meshStandardMaterial color="#d8cbb8" /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.078, 24]} /><meshStandardMaterial ref={m => { lamps.current[i] = m }} color={LAVA.red} emissive={LAVA.red} emissiveIntensity={.2} toneMapped={false} /></mesh>
    </group>)}
    {/* A molten pool glows in the caldera's center. */}
    <mesh position={[0.05, DECK_Y + .09, -5.45]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.3, 24]} /><meshStandardMaterial color={LAVA.orange} emissive={LAVA.orange} emissiveIntensity={.9} toneMapped={false} /></mesh>
  </group>
}

/** Wire habitrail: three steel rods that carry the ball from the caldera down to the right inlane. */
export function Habitrail() {
  const wires = useMemo(() => {
    const curve = new CatmullRomCurve3(HABITRAIL_PATH.map(([x, y, z]) => new Vector3(x, y + .23, z)))
    const points = curve.getPoints(160)
    return ([[-.17, -.06], [.17, -.06], [0, -.2]] as const).map(([side, drop]) => new TubeGeometry(new CatmullRomCurve3(points.map((p, i) => {
      const tangent = curve.getTangent(i / 160)
      const flat = Math.hypot(tangent.x, tangent.z) || 1
      return new Vector3(p.x - tangent.z / flat * side, p.y + drop, p.z + tangent.x / flat * side)
    })), 200, .016, 6, false))
  }, [])
  const braces = useMemo(() => [.12, .3, .48, .66, .84].map(t => new CatmullRomCurve3(HABITRAIL_PATH.map(([x, y, z]) => new Vector3(x, y, z))).getPoint(t)), [])
  useEffect(() => () => wires.forEach(g => g.dispose()), [wires])
  return <group>
    {wires.map((g, i) => <mesh key={i} geometry={g} castShadow><meshStandardMaterial color="#d8d2cc" metalness={1} roughness={.22} /></mesh>)}
    {braces.map((p, i) => <mesh key={i} position={[p.x, (p.y + .03) / 2, p.z]} castShadow>
      <cylinderGeometry args={[.025, .025, p.y + .03, 8]} /><meshStandardMaterial color="#3b2722" metalness={.6} roughness={.4} />
    </mesh>)}
  </group>
}

/** Basalt backstops behind the fissure and booster drop banks, set opposite the way each bank faces. */
export function BasaltShields() {
  const shapes = useMemo(() => [0, 2].map(bank => {
    const drops = DROPS.filter(d => d.bank === bank)
    const first: Vec2 = [drops[0].x, drops[0].z], last: Vec2 = [drops[2].x, drops[2].z]
    const mid: Vec2 = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2]
    const face = DROP_FACE[bank], length = Math.hypot(face[0] - mid[0], face[1] - mid[1])
    const bx = -(face[0] - mid[0]) / length, bz = -(face[1] - mid[1]) / length
    const ax = (last[0] - first[0]) / Math.hypot(last[0] - first[0], last[1] - first[1]), az = (last[1] - first[1]) / Math.hypot(last[0] - first[0], last[1] - first[1])
    const at = (point: Vec2, side: number, back: number): Vec2 => [point[0] + ax * side + bx * back, point[1] + az * side + bz * back]
    return polygonGeometry([at(first, -.22, .1), at(last, .22, .1), at(last, .16, .3), at(first, -.16, .3)], .12)
  }), [])
  useEffect(() => () => shapes.forEach(g => g.dispose()), [shapes])
  return <group>{shapes.map((g, i) => <group key={i}>
    <mesh geometry={g} position={[0, .28, 0]} castShadow><meshStandardMaterial color="#2a1a16" roughness={.8} /></mesh>
    <mesh geometry={g} position={[0, .255, 0]}><meshStandardMaterial color={LAVA.orange} emissive={LAVA.orange} emissiveIntensity={.4} roughness={.4} /></mesh>
  </group>)}</group>
}
