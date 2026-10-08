import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import {
  AdditiveBlending, CatmullRomCurve3, Color, DynamicDrawUsage, DoubleSide, ExtrudeGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D,
  Quaternion, Shape, TubeGeometry, Vector3,
} from 'three'
import type { SpaceCadetGame } from './game'
import {
  BUMPERS, CENTER_POST, DROPS, INSERTS, KICKERS, ROLLOVERS, SAUCERS, SEGMENTS,
  SERVE, SLINGS, SPINNERS, TABLE, TARGETS, WORMHOLES, type Insert, type Segment, type Vec2,
} from './layout'
import { createCadetBumperTexture, createCadetPlayfield, createVortexTexture } from './textures'

import { LaunchDeck, LaunchRamp, OrbitCanopy, TargetShields } from './RaisedHardware'
import { createGlassSheenTexture, createLampHaloTexture } from '../../components/tableTextures'

const ORANGE = '#b63740'
const CHROME = '#c9cfd8'
const chromeMaterial = new MeshStandardMaterial({ color: CHROME, metalness: .8, roughness: .26 })
const wallMaterial = new MeshStandardMaterial({ color: '#6e5852', metalness: .55, roughness: .38 })
const wallTrimMaterial = new MeshStandardMaterial({ color: ORANGE, emissive: ORANGE, emissiveIntensity: .08, metalness: .3, roughness: .3, toneMapped: false })

const FLIPPER_CENTER: Vec2 = [-0.25, 4.4]

const segmentTransform = (a: Vec2, b: Vec2, y: number) => {
  const direction = new Vector3(b[0] - a[0], 0, b[1] - a[1])
  return {
    position: [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2] as [number, number, number],
    rotationY: Math.atan2(-(b[1] - a[1]), b[0] - a[0]),
    length: direction.length(),
    quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
  }
}
const facing = (from: Vec2, to: Vec2) => Math.atan2(to[0] - from[0], to[1] - from[1])

/** Solid cabinet wall pieces, including every facet of the top arc. */
function Walls() {
  const pieces = useMemo(() => SEGMENTS.filter(s => s.kind === 'wall').map(s => segmentTransform(s.a, s.b, 0.19)), [])
  return <group>
    {pieces.map((piece, i) => <group key={i} position={piece.position} rotation={[0, piece.rotationY, 0]}>
      <mesh material={wallMaterial} castShadow receiveShadow>
        <boxGeometry args={[piece.length + 0.02, 0.38, 0.15]} />
      </mesh>
      <mesh position={[0, 0.2, 0]} material={wallTrimMaterial}>
        <boxGeometry args={[piece.length + 0.02, 0.025, 0.11]} />
      </mesh>
    </group>)}
  </group>
}

function Guide({ segment }: { segment: Segment }) {
  const { position, quaternion, length } = useMemo(() => segmentTransform(segment.a, segment.b, 0.17), [segment])
  const radius = segment.radius ?? 0.065
  const sling = segment.kind === 'sling'
  return <mesh position={position} quaternion={quaternion} castShadow>
    <cylinderGeometry args={[sling ? 0.075 : radius * 0.7, sling ? 0.075 : radius * 0.7, length, 12]} />
    <meshStandardMaterial color={sling ? '#bb3542' : CHROME} metalness={sling ? 0.05 : 1} roughness={sling ? 0.6 : 0.18} />
  </mesh>
}

function Posts() {
  const posts = useRef<InstancedMesh>(null)
  const caps = useRef<InstancedMesh>(null)
  const points = useMemo(() => {
    const unique = new Map<string, Vec2>()
    for (const s of SEGMENTS) if (s.kind === 'guide' || s.kind === 'sling') for (const p of [s.a, s.b]) unique.set(p.join(), p)
    return [...unique.values()]
  }, [])
  useEffect(() => {
    const object = new Object3D()
    points.forEach(([x, z], i) => {
      object.position.set(x, .14, z)
      object.updateMatrix()
      posts.current!.setMatrixAt(i, object.matrix)
      object.position.y = .29
      object.updateMatrix()
      caps.current!.setMatrixAt(i, object.matrix)
    })
    posts.current!.instanceMatrix.needsUpdate = true
    caps.current!.instanceMatrix.needsUpdate = true
    posts.current!.computeBoundingSphere()
    caps.current!.computeBoundingSphere()
  }, [points])
  return <group>
    <instancedMesh ref={posts} args={[undefined, undefined, points.length]} material={chromeMaterial}>
      <cylinderGeometry args={[.055, .07, .28, 12]} />
    </instancedMesh>
    <instancedMesh ref={caps} args={[undefined, undefined, points.length]}>
      <cylinderGeometry args={[.045, .045, .03, 10]} />
      <meshStandardMaterial color="#ff3b3b" emissive="#ff3b3b" emissiveIntensity={.4} />
    </instancedMesh>
  </group>
}

function Slingshot({ game, side }: { game: SpaceCadetGame; side: 0 | 1 }) {
  const material = useRef<MeshStandardMaterial>(null)
  const geometry = useMemo(() => {
    const points = side === 0 ? SLINGS.left : SLINGS.right
    const cx = points.reduce((sum, p) => sum + p[0], 0) / 3
    const cz = points.reduce((sum, p) => sum + p[1], 0) / 3
    const shape = new Shape()
    points.forEach(([px, pz], i) => {
      const sx = cx + (px - cx) * 0.86
      const sz = -(cz + (pz - cz) * 0.86)
      if (i) shape.lineTo(sx, sz)
      else shape.moveTo(sx, sz)
    })
    shape.closePath()
    return new ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 })
  }, [side])
  const lightning = useMemo(() => {
    const points = side === 0 ? SLINGS.left : SLINGS.right
    const [top, , inner] = points
    return [0, 1].map(n => {
      const sx = top[0] + (inner[0] - top[0]) * .12
      const path = [
        new Vector3(sx,.236,top[1]+.25+n*.23),
        new Vector3(sx+(inner[0]-top[0])*.3,.236,top[1]+.55+n*.23),
        new Vector3(sx+(inner[0]-top[0])*.1,.236,top[1]+.73+n*.23),
        new Vector3(inner[0]-(inner[0]-top[0])*.23,.236,inner[1]-.33),
      ]
      return new TubeGeometry(new CatmullRomCurve3(path, false, 'catmullrom', .04), 20, .013, 6, false)
    })
  }, [side])
  useEffect(() => () => { geometry.dispose(); lightning.forEach(g => g.dispose()) }, [geometry, lightning])
  useFrame(() => {
    if (material.current) material.current.emissiveIntensity = 0.05 + game.slingFlashes[side] * 2
  })
  return <group>
    <mesh geometry={geometry} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
      <meshStandardMaterial attach="material-0" ref={material} color="#252741" emissive="#4ea7e3" roughness={.35}/>
      <meshStandardMaterial attach="material-1" color="#ac3443" roughness={.45}/>
    </mesh>
    {lightning.map((g,i)=><mesh key={i} geometry={g}><meshStandardMaterial color="#b6e8ef" emissive="#66cded" emissiveIntensity={.6}/></mesh>)}
  </group>
}

function Bumper({ game, index }: { game: SpaceCadetGame; index: number }) {
  const { x, z, radius, kind, elevation } = BUMPERS[index]
  const color = '#315a9b'
  const capLight = useRef<MeshStandardMaterial>(null)
  const cap = useRef<Mesh>(null)
  const light = useRef<MeshStandardMaterial>(null)
  const texture = useMemo(() => createCadetBumperTexture(color), [color])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame(() => {
    const flash = Math.min(1, game.bumperFlashes[index] * 4)
    const levelColor = ['#398aff', '#48d06b', '#ffd438', '#ff4141'][kind === 'attack' ? game.attackLevel : game.engineLevel]
    for (const material of [light.current, capLight.current]) if (material) {
      material.color.set(levelColor); material.emissive.set(levelColor); material.emissiveIntensity = .3 + flash * 1.5
    }
    if (cap.current) cap.current.position.y = 0.48 - flash * 0.06
  })
  return <group position={[x, elevation + (elevation ? .065 : 0), z]}>
    <mesh position={[0, 0.04, 0]} receiveShadow>
      <cylinderGeometry args={[radius + 0.1, radius + 0.12, 0.08, 40]} />
      <meshStandardMaterial color="#f2f2f6" roughness={0.35} />
    </mesh>
    <mesh position={[0, 0.24, 0]} castShadow>
      <cylinderGeometry args={[radius - 0.09, radius - .05, 0.36, 40]} />
      <meshStandardMaterial color="#e6e4d5" metalness={.25} roughness={0.3} />
    </mesh>
    <mesh position={[0, 0.27, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius - 0.01, 0.03, 8, 40]} />
      <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
    </mesh>
    <mesh ref={cap} position={[0, 0.48, 0]} castShadow>
      <cylinderGeometry args={[radius - 0.04, radius + 0.01, 0.12, 40]} />
      <meshStandardMaterial ref={light} color="#fff5da" emissive={color} emissiveIntensity={0.05} roughness={0.25} toneMapped={false} />
      <mesh position={[0, 0.062, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius - 0.025, 40]} />
        <meshStandardMaterial ref={capLight} map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.08} roughness={0.4} />
      </mesh>
    </mesh>
  </group>
}

function Targets({ game }: { game: SpaceCadetGame }) {
  const materials = useRef<(MeshStandardMaterial | null)[]>([])
  useFrame(() => {
    materials.current.forEach((material, i) => {
      if (material) material.emissiveIntensity = 0.2 + (game.targetLit[i] ? 1.4 : 0) + game.targetFlashes[i] * 2.5
    })
  })
  return <group>
    {TARGETS.map((target, i) => {
      const face: Vec2 = target.group === 'mission' ? [0, target.z] : target.group === 'comet' ? [-3, target.z] : FLIPPER_CENTER
      const color = '#dc303b'
      return <group key={`${target.x},${target.z}`} position={[target.x, 0, target.z]} rotation={[0, facing([target.x, target.z], face), 0]}>
        <mesh position={[0, 0.16, -0.03]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[.12, .12, .06, 24]} />
          <meshStandardMaterial ref={m => { materials.current[i] = m }} color={color} emissive={color} emissiveIntensity={0.2} roughness={0.35} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.12, -0.09]}>
          <boxGeometry args={[0.06, 0.24, 0.06]} />
          <meshStandardMaterial color="#2a2f3a" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    })}
  </group>
}

function DropTargets({ game }: { game: SpaceCadetGame }) {
  const groups = useRef<(Group | null)[]>([])
  useFrame((_, delta) => {
    groups.current.forEach((group, i) => {
      if (!group) return
      const target = game.dropsDown[i] ? -0.3 : 0
      group.position.y += (target - group.position.y) * Math.min(1, delta * 18)
    })
  })
  return <group>
    {DROPS.map((drop, i) => <group key={i} position={[drop.x, 0, drop.z]} rotation={[0, drop.bank === 2 ? -Math.PI / 2 : drop.bank === 0 ? .4 : 0, 0]}>
      <group ref={g => { groups.current[i] = g }}>
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.3, 0.3, 0.08]} />
          <meshStandardMaterial color="#ffdb3e" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.15, 0.041]}>
          <planeGeometry args={[0.3, 0.09]} />
          <meshStandardMaterial color="#fff4d1" emissive="#fff4d1" emissiveIntensity={0.15} />
        </mesh>
      </group>
      <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.34, 0.12]} />
        <meshStandardMaterial color="#05060f" />
      </mesh>
    </group>)}
  </group>
}

function Rollovers() {
  return <group>
    {ROLLOVERS.map(r => <mesh key={`${r.x},${r.z}`} position={[r.x, r.kind === 'engine' ? .97 : 0.03, r.z]} rotation={[Math.PI / 2, 0, 0]}>
      <capsuleGeometry args={[0.02, 0.18, 4, 8]} />
      <meshStandardMaterial color={CHROME} metalness={1} roughness={0.15} />
    </mesh>)}
  </group>
}

/** Flags (7, 33): spinners hung across the orbit lanes. */
function Spinners({ game }: { game: SpaceCadetGame }) {
  const flags = useRef<(Group | null)[]>([])
  useFrame(() => flags.current.forEach((flag, i) => { if (flag) flag.rotation.x = game.spinnerAngles[i] }))
  return <group>
    {SPINNERS.map((spinner, i) => {
      const width = spinner.x1 - spinner.x0
      const cx = (spinner.x0 + spinner.x1) / 2
      return <group key={i} position={[cx, 0, spinner.z]}>
        {[-1, 1].map(side => <mesh key={side} position={[side * (width / 2 - 0.05), 0.2, 0]}>
          <boxGeometry args={[0.04, 0.4, 0.04]} />
          <meshStandardMaterial color={CHROME} metalness={1} roughness={0.2} />
        </mesh>)}
        <group ref={g => { flags.current[i] = g }} position={[0, 0.36, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <boxGeometry args={[width - 0.16, 0.22, 0.015]} />
            <meshStandardMaterial color="#f5f4e9" metalness={0.4} roughness={0.3} side={DoubleSide} />
          </mesh>
          <mesh position={[0, -0.12, 0.009]}>
            <planeGeometry args={[width - 0.24, 0.08]} />
            <meshStandardMaterial color="#e0262f" side={DoubleSide} />
          </mesh>
        </group>
      </group>
    })}
  </group>
}

function Saucers() {
  return <group>
    {SAUCERS.map(s => <group key={s.kind} position={[s.x, 0, s.z]}>
      <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.19, 32]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.03, 8, 32]} />
        <meshStandardMaterial color={CHROME} metalness={1} roughness={0.2} />
      </mesh>
    </group>)}
  </group>
}

function Vortex({ x, z, radius, inner, outer, speed }: { x: number; z: number; radius: number; inner: string; outer: string; speed: number }) {
  const mesh = useRef<Mesh>(null)
  const texture = useMemo(() => createVortexTexture(inner, outer), [inner, outer])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame((_, delta) => { if (mesh.current) mesh.current.rotation.z += delta * speed })
  return <group position={[x, 0, z]}>
    <mesh ref={mesh} position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 48]} />
      <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.25} toneMapped={false} />
    </mesh>
    <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius + 0.01, 0.028, 8, 48]} />
      <meshStandardMaterial color={CHROME} metalness={1} roughness={0.18} />
    </mesh>
  </group>
}

function insertGeometry(shape: Insert['shape'], size: number) {
  const s = new Shape()
  if (shape === 'circle') s.absarc(0, 0, size, 0, Math.PI * 2, false)
  else if (shape === 'ring') {
    s.absarc(0, 0, size, 0, Math.PI * 2, false)
    const hole = new Shape()
    hole.absarc(0, 0, size - 0.045, 0, Math.PI * 2, true)
    s.holes.push(hole)
  } else if (shape === 'rect') {
    s.moveTo(-size * 1.4, -size * 0.6); s.lineTo(size * 1.4, -size * 0.6); s.lineTo(size * 1.4, size * 0.6); s.lineTo(-size * 1.4, size * 0.6)
  } else if (shape === 'triangle') {
    s.moveTo(0, size); s.lineTo(size * 0.9, -size * 0.7); s.lineTo(-size * 0.9, -size * 0.7)
  } else if (shape === 'arrow') {
    s.moveTo(0, size * 1.3); s.lineTo(size * 0.85, size * 0.1); s.lineTo(size * 0.35, size * 0.1); s.lineTo(size * 0.35, -size)
    s.lineTo(-size * 0.35, -size); s.lineTo(-size * 0.35, size * 0.1); s.lineTo(-size * 0.85, size * 0.1)
  } else {
    const w = size * 0.28
    s.moveTo(-size, -size + w); s.lineTo(-size + w, -size); s.lineTo(0, -w); s.lineTo(size - w, -size); s.lineTo(size, -size + w); s.lineTo(w, 0)
    s.lineTo(size, size - w); s.lineTo(size - w, size); s.lineTo(0, w); s.lineTo(-size + w, size); s.lineTo(-size, size - w); s.lineTo(-w, 0)
  }
  s.closePath()
  return new ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 24 })
}

/** Every playfield lamp (10–14, 17–18, 24, 26, 31, 36–39, 44–46, 53, …) driven by the game state. */
function Inserts({ game }: { game: SpaceCadetGame }) {
  const batches = useMemo(() => Array.from(new Set(INSERTS.map(insert => insert.shape))).map(shape => ({
    shape,
    inserts: INSERTS.filter(insert => insert.shape === shape),
    geometry: insertGeometry(shape, .3),
  })), [])
  const meshes = useRef<(InstancedMesh | null)[]>([])
  const haloMesh = useRef<InstancedMesh>(null)
  const haloTexture = useMemo(createLampHaloTexture, [])
  const colors = useMemo(() => INSERTS.map(insert => new Color(insert.color)), [])
  const batchColors = useMemo(() => batches.map(batch => batch.inserts.map(insert => new Color(insert.color))), [batches])
  const tint = useMemo(() => new Color(), [])
  useEffect(() => () => { batches.forEach(batch => batch.geometry.dispose()); haloTexture.dispose() }, [batches, haloTexture])
  useEffect(() => {
    const object = new Object3D()
    batches.forEach((batch, batchIndex) => {
      const mesh = meshes.current[batchIndex]!
      batch.inserts.forEach((insert, i) => {
        object.position.set(insert.x, .03, insert.z)
        object.rotation.set(-Math.PI / 2, 0, insert.toward ? facing([insert.x, insert.z], insert.toward) + Math.PI : 0)
        object.scale.set(insert.size / .3, insert.size / .3, 1)
        object.updateMatrix()
        mesh.setMatrixAt(i, object.matrix)
        mesh.setColorAt(i, tint.set(insert.light === 'wormholeExit' ? WORMHOLES[game.wormholeExit].color : batchColors[batchIndex][i]).multiplyScalar(.3))
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor!.setUsage(DynamicDrawUsage)
      mesh.computeBoundingSphere()
    })
    INSERTS.forEach((insert, i) => {
      object.position.set(insert.x, .045, insert.z)
      object.rotation.set(-Math.PI / 2, 0, 0)
      object.scale.set(insert.size * 5.2, insert.size * 5.2, 1)
      object.updateMatrix()
      haloMesh.current!.setMatrixAt(i, object.matrix)
      haloMesh.current!.setColorAt(i, tint.setRGB(0, 0, 0))
    })
    haloMesh.current!.instanceMatrix.needsUpdate = true
    haloMesh.current!.instanceColor!.setUsage(DynamicDrawUsage)
    haloMesh.current!.computeBoundingSphere()
  }, [batches, batchColors, tint])
  useFrame(() => {
    batches.forEach((batch, batchIndex) => {
      const mesh = meshes.current[batchIndex]
      if (!mesh?.instanceColor) return
      batch.inserts.forEach((insert, i) => {
        const level = game.lightLevel(insert.light, insert.index)
        mesh.setColorAt(i, tint.set(insert.light === 'wormholeExit' ? WORMHOLES[game.wormholeExit].color : batchColors[batchIndex][i]).multiplyScalar(.3 + level * 1.8))
      })
      mesh.instanceColor.needsUpdate = true
    })
    if (haloMesh.current?.instanceColor) {
      INSERTS.forEach((insert, i) => haloMesh.current!.setColorAt(i,
        tint.set(insert.light === 'wormholeExit' ? WORMHOLES[game.wormholeExit].color : colors[i]).multiplyScalar(game.lightLevel(insert.light, insert.index) * .9)))
      haloMesh.current.instanceColor.needsUpdate = true
    }
  })
  return <group>
    {batches.map((batch, i) => <instancedMesh key={batch.shape} ref={mesh => { meshes.current[i] = mesh }} args={[batch.geometry, undefined, batch.inserts.length]}>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>)}
    <instancedMesh ref={haloMesh} args={[undefined, undefined, INSERTS.length]} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={haloTexture} blending={AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
    </instancedMesh>
  </group>
}

function Kickers({ game }: { game: SpaceCadetGame }) {
  const plungers = useRef<(Mesh | null)[]>([])
  useFrame(() => plungers.current.forEach((p, i) => { if (p) p.position.y = game.kickersArmed[i] ? 0.09 : 0.05 }))
  return <group>
    {KICKERS.map((kicker, i) => <group key={i} position={[kicker.x, 0, kicker.z + 0.12]}>
      <mesh ref={m => { plungers.current[i] = m }} position={[0, 0.05, 0]}>
        <boxGeometry args={[0.2, 0.08, 0.08]} />
        <meshStandardMaterial color="#e0262f" emissive="#e0262f" emissiveIntensity={0.4} />
      </mesh>
    </group>)}
  </group>
}

function CenterPost({ game }: { game: SpaceCadetGame }) {
  const post = useRef<Group>(null)
  useFrame((_, delta) => {
    if (!post.current) return
    const target = game.centerPostUp ? 0 : -0.32
    post.current.position.y += (target - post.current.position.y) * Math.min(1, delta * 12)
  })
  return <group position={[CENTER_POST.x, 0, CENTER_POST.z]}>
    <group ref={post} position={[0, -0.32, 0]}>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[CENTER_POST.radius, CENTER_POST.radius, 0.3, 20]} />
        <meshStandardMaterial color={CHROME} metalness={1} roughness={0.15} />
      </mesh>
      <mesh position={[0, 0.31, 0]}>
        <sphereGeometry args={[CENTER_POST.radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#ff3b3b" emissive="#ff3b3b" emissiveIntensity={1.2} toneMapped={false} />
      </mesh>
    </group>
    <mesh position={[0, 0.026, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[CENTER_POST.radius, CENTER_POST.radius + 0.04, 20]} />
      <meshStandardMaterial color={CHROME} metalness={1} roughness={0.2} />
    </mesh>
  </group>
}

/** Plunger (51) at the foot of the deployment chute (50). */
function Shooter({ game }: { game: SpaceCadetGame }) {
  const coil = useRef<Mesh>(null)
  const plunger = useRef<Mesh>(null)
  const knob = useRef<Mesh>(null)
  const spring = useMemo(() => {
    const points = Array.from({ length: 161 }, (_, i) => {
      const angle = i / 160 * Math.PI * 2 * 11
      return new Vector3(Math.sin(angle) * 0.104, 0.13 + Math.cos(angle) * 0.104, i / 160)
    })
    return new TubeGeometry(new CatmullRomCurve3(points), 180, 0.024, 6, false)
  }, [])
  useEffect(() => () => spring.dispose(), [spring])
  useFrame(() => {
    const pull = game.charge * 0.3
    if (coil.current) { coil.current.scale.z = 0.4 - pull; coil.current.position.z = 5.9 + pull }
    if (plunger.current) plunger.current.position.z = 5.84 + pull
    if (knob.current) knob.current.position.z = 6.5 + pull
  })
  return <group position={[SERVE.x, 0, 0]}>
    <mesh ref={coil} geometry={spring} position={[0, 0, 5.9]} scale={[1, 1, 0.4]}>
      <meshStandardMaterial color={CHROME} roughness={0.2} metalness={1} />
    </mesh>
    <mesh ref={plunger} position={[0, 0.13, 5.84]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[0.16, 0.16, 0.12, 24]} />
      <meshStandardMaterial color={CHROME} metalness={1} roughness={0.2} />
    </mesh>
    <mesh position={[0, 0.13, 6.25]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.06, 0.06, 0.6, 16]} />
      <meshStandardMaterial color={CHROME} metalness={1} roughness={0.17} />
    </mesh>
    <mesh ref={knob} position={[0, 0.13, 6.5]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.19, 0.17, 0.18, 32]} />
      <meshStandardMaterial color="#e0262f" metalness={0.4} roughness={0.25} />
    </mesh>
  </group>
}

export function SpaceCadetTable({ game }: { game: SpaceCadetGame }) {
  const playfield = useMemo(createCadetPlayfield, [])
  const glass = useMemo(createGlassSheenTexture, [])
  useEffect(() => () => { playfield.dispose(); glass.dispose() }, [playfield, glass])
  const width = TABLE.right - TABLE.left
  const depth = TABLE.bottom - TABLE.top
  const guides = SEGMENTS.filter(s => s.kind !== 'wall' && s.kind !== 'gate')
  const gate = SEGMENTS.find(s => s.kind === 'gate')!
  const gateTransform = segmentTransform(gate.a, gate.b, 0.24)
  return (
    <group>
      {/* Black cabinet with a brushed rail around the glass line. */}
      <RoundedBox args={[width + 0.5, 0.62, depth + 0.6]} position={[0, -0.48, 0.15]} radius={0.22} smoothness={5} castShadow receiveShadow>
        <meshStandardMaterial color="#07080f" metalness={0.5} roughness={0.4} />
      </RoundedBox>
      <RoundedBox args={[width + 0.36, 0.1, depth + 0.44]} position={[0, -0.14, 0.12]} radius={0.04} smoothness={2}>
        <meshStandardMaterial color="#5a5f70" metalness={1} roughness={0.3} />
      </RoundedBox>
      <RoundedBox args={[width + 0.24, 0.18, depth + 0.3]} position={[0, -0.07, 0.1]} radius={0.06} smoothness={2} receiveShadow>
        <meshStandardMaterial color="#0b0d1c" metalness={0.4} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0.021, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshPhysicalMaterial map={playfield} roughness={.48} metalness={0} envMapIntensity={.18} clearcoat={.4} clearcoatRoughness={.28} emissiveMap={playfield} emissive="#ffffff" emissiveIntensity={.08} />
      </mesh>
      {/* Raised blackout over the corners outside the arc. */}
      {[-1, 1].map(side => <RoundedBox key={side} args={[0.26, 0.42, depth + 0.1]} position={[side * (TABLE.right + 0.12), 0.15, 0.05]} radius={0.06} smoothness={3} castShadow>
        <meshStandardMaterial color="#10132a" metalness={.8} roughness={.35} />
      </RoundedBox>)}
      <RoundedBox args={[width + 0.5, 0.42, 0.26]} position={[0, 0.15, TABLE.top - 0.12]} radius={0.06} smoothness={3} castShadow>
        <meshStandardMaterial color="#10132a" metalness={.8} roughness={.35} />
      </RoundedBox>
      {[-1, 1].map(side => <RoundedBox key={side} args={[.075, .045, depth + .05]} position={[side * (TABLE.right + .12), .377, .05]} radius={.015} smoothness={3}>
        <meshStandardMaterial color={CHROME} metalness={.8} roughness={.35} />
      </RoundedBox>)}
      <RoundedBox args={[width + 0.24, 0.16, 0.22]} position={[0, 0.08, TABLE.bottom + 0.02]} radius={0.05} smoothness={3}>
        <meshStandardMaterial color="#5a5f70" metalness={1} roughness={0.25} />
      </RoundedBox>

      <Walls />
      {guides.map((segment, i) => <Guide key={i} segment={segment} />)}
      <Posts />
      <mesh position={gateTransform.position} rotation={[0, gateTransform.rotationY, 0]}>
        <boxGeometry args={[gateTransform.length, 0.18, 0.02]} />
        <meshStandardMaterial color={CHROME} metalness={1} roughness={0.2} />
      </mesh>
      <Slingshot game={game} side={0} />
      <Slingshot game={game} side={1} />
      {BUMPERS.map((_, i) => <Bumper key={i} game={game} index={i} />)}
      <Targets game={game} />
      <DropTargets game={game} />
      <Rollovers />
      <Spinners game={game} />
      <Saucers />
      {WORMHOLES.map(w => <Vortex key={w.color} x={w.x} z={w.z} radius={w.radius} inner={w.color} outer="#1a1a5a" speed={-2.4} />)}

      <Inserts game={game} />
      <LaunchDeck game={game} />
      <LaunchRamp />
      <OrbitCanopy />
      <TargetShields />
      <Kickers game={game} />
      <CenterPost game={game} />
      <Shooter game={game} />
      <mesh position={[0, .62, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
        <planeGeometry args={[width - .2, depth - .1]} />
        <meshBasicMaterial map={glass} transparent opacity={.05} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
