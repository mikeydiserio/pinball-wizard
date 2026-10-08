import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import {
  AdditiveBlending, CatmullRomCurve3, ExtrudeGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, Quaternion, Shape, TubeGeometry, Vector3,
} from 'three'
import { BUMPERS, LAUNCH_GATE, RAILS, TARGETS, type PinballGame } from '../game/physics'
import { createBumperTexture, createGlassSheenTexture, createLampHaloTexture, createPlayfieldTexture } from './tableTextures'

const ORANGE = '#ff672c'
const CREAM = '#eee3ca'

function Fasteners() {
  const mesh = useRef<InstancedMesh>(null)
  const positions = useMemo(() => {
    const points: [number, number, number][] = []
    for (const x of [-3.08, 3.08]) for (const z of [-4.7, -2.9, -.9, 1.2, 3.3, 5.11]) points.push([x, .37, z])
    for (const x of [-2.35, -.8, .8, 2.35]) points.push([x, .37, -5.24], [x, .20, 5.25])
    return points
  }, [])
  useEffect(() => {
    const object = new Object3D()
    positions.forEach((position, i) => {
      object.position.set(...position)
      object.rotation.y = i * 1.72
      object.updateMatrix()
      mesh.current!.setMatrixAt(i, object.matrix)
    })
    mesh.current!.instanceMatrix.needsUpdate = true
  }, [positions])
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, positions.length]}>
      <cylinderGeometry args={[.052, .046, .027, 6]} />
      <meshStandardMaterial color="#a0a399" roughness={.27} metalness={.9} />
    </instancedMesh>
  )
}

function Rail({ a, b, kind }: (typeof RAILS)[number]) {
  const { center, quaternion, length } = useMemo(() => {
    const direction = new Vector3(b[0] - a[0], 0, b[1] - a[1])
    return {
      center: [(a[0] + b[0]) / 2, .21, (a[1] + b[1]) / 2] as [number, number, number],
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()),
      length: direction.length(),
    }
  }, [a, b])
  const isSling = kind === 'sling'
  return (
    <group>
      <mesh position={center} quaternion={quaternion} castShadow>
        <cylinderGeometry args={[isSling ? .076 : .044, isSling ? .076 : .044, length, 10]} />
        <meshStandardMaterial color={isSling ? '#d2c8b3' : '#b8c0ba'} metalness={isSling ? .3 : 1} roughness={isSling ? .44 : .2} />
      </mesh>
      {kind !== 'wall' && <mesh position={[center[0], .075, center[2]]} quaternion={quaternion}>
        <cylinderGeometry args={[.026, .026, length, 8]} />
        <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={isSling ? 1.1 : .28} metalness={.5} roughness={.35} />
      </mesh>}
    </group>
  )
}

function RailPosts() {
  const posts = useRef<InstancedMesh>(null)
  const caps = useRef<InstancedMesh>(null)
  const points = useMemo(() => {
    const unique = new Map<string, readonly [number, number]>()
    RAILS.filter(rail => rail.kind !== 'wall').forEach(rail => {
      for (const point of [rail.a, rail.b]) unique.set(point.join(','), point)
    })
    return Array.from(unique.values())
  }, [])
  useEffect(() => {
    const object = new Object3D()
    points.forEach(([x, z], i) => {
      object.position.set(x, .13, z)
      object.updateMatrix()
      posts.current!.setMatrixAt(i, object.matrix)
      object.position.y = .267
      object.updateMatrix()
      caps.current!.setMatrixAt(i, object.matrix)
    })
    posts.current!.instanceMatrix.needsUpdate = true
    caps.current!.instanceMatrix.needsUpdate = true
  }, [points])
  return <group>
    <instancedMesh ref={posts} args={[undefined, undefined, points.length]}>
      <cylinderGeometry args={[.055, .073, .26, 12]} />
      <meshStandardMaterial color="#939e8b" metalness={1} roughness={.2} />
    </instancedMesh>
    <instancedMesh ref={caps} args={[undefined, undefined, points.length]}>
      <cylinderGeometry args={[.042, .042, .022, 6]} />
      <meshStandardMaterial color="#212a23" metalness={.75} roughness={.4} />
    </instancedMesh>
  </group>
}

function Bumper({ index, game }: { index: number; game: PinballGame }) {
  const { x, z, radius } = BUMPERS[index]
  const light = useRef<MeshStandardMaterial>(null)
  const cap = useRef<Mesh>(null)
  const texture = useMemo(() => createBumperTexture(index), [index])
  useEffect(() => () => texture.dispose(), [texture])
  useFrame(() => {
    const flash = Math.min(1, (game.bumperFlashes[index] ?? 0) * 4)
    if (light.current) light.current.emissiveIntensity = .95 + flash * 4
    if (cap.current) cap.current.position.y = .355 - flash * .065
  })
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, .045, 0]} receiveShadow>
        <cylinderGeometry args={[radius + .09, radius + .12, .09, 48]} />
        <meshStandardMaterial color="#313b34" roughness={.33} metalness={.85} />
      </mesh>
      <mesh position={[0, .11, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius + .015, .031, 8, 48]} />
        <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={1.3} toneMapped={false} />
      </mesh>
      <mesh position={[0, .19, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, .15, 48]} />
        <meshStandardMaterial color="#262b25" metalness={.3} roughness={.56} />
      </mesh>
      <mesh position={[0, .26, 0]} castShadow>
        <cylinderGeometry args={[radius + .015, radius - .07, .1, 48]} />
        <meshStandardMaterial color="#bcc2b2" metalness={1} roughness={.2} />
      </mesh>
      <mesh ref={cap} position={[0, .355, 0]} castShadow>
        <cylinderGeometry args={[radius - .025, radius + .01, .1, 48]} />
        <meshStandardMaterial ref={light} color={ORANGE} emissive={ORANGE} emissiveIntensity={1.1} roughness={.3} metalness={.28} toneMapped={false} />
        <mesh position={[0, .054, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[radius - .075, 48]} />
          <meshStandardMaterial map={texture} roughness={.5} metalness={.25} />
        </mesh>
      </mesh>
    </group>
  )
}

function SlingshotPanel({ side }: { side: number }) {
  const { body, inset, bolts } = useMemo(() => {
    const points = side < 0 ? [[-2.35, 1], [-2.35, 2.5], [-1.35, 2.9]] : [[2.08, 1], [2.08, 2.5], [1.15, 2.9]]
    const center = points.reduce((sum, point) => [sum[0] + point[0] / 3, sum[1] + point[1] / 3], [0, 0])
    const shape = (scale: number) => {
      const outline = new Shape()
      points.forEach((point, i) => {
        const x = center[0] + (point[0] - center[0]) * scale
        const z = center[1] + (point[1] - center[1]) * scale
        if (i === 0) outline.moveTo(x, -z)
        else outline.lineTo(x, -z)
      })
      outline.closePath()
      return outline
    }
    return {
      body: new ExtrudeGeometry(shape(.84), { depth: .13, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .025, bevelThickness: .02 }),
      inset: new ExtrudeGeometry(shape(.66), { depth: .012, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .015, bevelThickness: .01 }),
      bolts: points.map(point => [center[0] + (point[0] - center[0]) * .62, center[1] + (point[1] - center[1]) * .62]),
    }
  }, [side])
  useEffect(() => () => { body.dispose(); inset.dispose() }, [body, inset])
  return <group>
    <mesh geometry={body} position={[0, .04, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
      <meshStandardMaterial color="#c6c9b1" roughness={.3} metalness={.76} />
    </mesh>
    <mesh geometry={inset} position={[0, .2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color={ORANGE} roughness={.43} metalness={.25} />
    </mesh>
    {bolts.map(([x, z], i) => <mesh key={i} position={[x, .238, z]}>
      <cylinderGeometry args={[.027, .027, .019, 6]} />
      <meshStandardMaterial color="#33382e" metalness={.9} roughness={.24} />
    </mesh>)}
  </group>
}

function LaunchGate({ game }: { game: PinballGame }) {
  const panel = useRef<Group>(null)
  const width = LAUNCH_GATE.b[0] - LAUNCH_GATE.a[0]
  const x = (LAUNCH_GATE.a[0] + LAUNCH_GATE.b[0]) / 2
  const z = LAUNCH_GATE.a[1]
  useFrame(() => {
    // The barrier and collider change together after the ball clears the lane.
    if (panel.current) panel.current.position.y = game.launchGateClosed ? .18 : -.195
  })
  return <group position={[x, 0, z]}>
    <group ref={panel} position={[0, game.launchGateClosed ? .18 : -.195, 0]}>
      <RoundedBox args={[width, .36, .11]} radius={.015} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color="#aab2a2" metalness={1} roughness={.24} />
      </RoundedBox>
      {[-1, 1].map(side => <group key={side} position={[0, 0, side * .0551]} rotation={[0, side < 0 ? Math.PI : 0, 0]}>
        <mesh position={[0, -.016, 0]}>
          <planeGeometry args={[width - .09, .24]} />
          <meshStandardMaterial color="#273027" metalness={.65} roughness={.38} />
        </mesh>
        <mesh position={[0, .12, 0]}>
          <planeGeometry args={[width - .09, .027]} />
          <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={.25} metalness={.2} roughness={.4} />
        </mesh>
      </group>)}
      <mesh position={[0, .1801, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width - .1, .067]} />
        <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={.3} metalness={.25} roughness={.36} />
      </mesh>
    </group>
  </group>
}

function Shooter({ game }: { game: PinballGame }) {
  const coil = useRef<Mesh>(null)
  const plunger = useRef<Mesh>(null)
  const knob = useRef<Mesh>(null)
  const spring = useMemo(() => {
    const points = Array.from({ length: 161 }, (_, i) => {
      const angle = i / 160 * Math.PI * 2 * 11
      return new Vector3(Math.sin(angle) * .104, .13 + Math.cos(angle) * .104, i / 160)
    })
    return new TubeGeometry(new CatmullRomCurve3(points), 180, .024, 6, false)
  }, [])
  useEffect(() => () => spring.dispose(), [spring])
  useFrame(() => {
    const pull = game.charge * .32
    if (coil.current) { coil.current.scale.z = .52 - pull; coil.current.position.z = 4.98 + pull }
    if (plunger.current) plunger.current.position.z = 4.92 + pull
    if (knob.current) knob.current.position.z = 5.78 + pull
  })
  return <group position={[2.76, 0, 0]}>
    <mesh ref={coil} geometry={spring} position={[0, 0, 4.98]} scale={[1, 1, .52]}>
      <meshStandardMaterial color="#c3c5b7" roughness={.21} metalness={1} />
    </mesh>
    <mesh ref={plunger} position={[0, .13, 4.92]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[.16, .16, .12, 24]} />
      <meshStandardMaterial color="#b8bcad" metalness={1} roughness={.22} />
    </mesh>
    <mesh position={[0, .13, 5.49]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[.07, .07, .56, 16]} />
      <meshStandardMaterial color="#b8bcad" metalness={1} roughness={.17} />
    </mesh>
    <mesh ref={knob} position={[0, .13, 5.78]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[.19, .17, .18, 32]} />
      <meshStandardMaterial color="#c54c21" metalness={.45} roughness={.25} />
    </mesh>
  </group>
}

function Inserts({ game }: { game: PinballGame }) {
  const halo = useMemo(createLampHaloTexture, [])
  useEffect(() => () => halo.dispose(), [halo])
  const halos = useRef<(MeshBasicMaterial | null)[]>([])
  const materials = useRef<(MeshStandardMaterial | null)[]>([])
  useFrame(({ clock }) => {
    materials.current.forEach((material, i) => {
      const level = game.targetLights[i] ? 1 : .035 + Math.sin(clock.elapsedTime * 1.6 + i * .9) * .015
      if (material) material.emissiveIntensity = .1 + level * 3.5
      if (halos.current[i]) halos.current[i]!.opacity = level * .9
    })
  })
  return <group>
    {TARGETS.map(({ x, z }, i) => <group key={x} position={[x, .035, z]}>
      <mesh position={[0, .051, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[.78, 1.25]} />
        <meshBasicMaterial ref={material => { halos.current[i] = material }} map={halo} color="#ff8b29" transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <RoundedBox args={[.30, .055, .48]} radius={.02} smoothness={3}>
        <meshStandardMaterial color="#535d50" metalness={.9} roughness={.25} />
      </RoundedBox>
      <RoundedBox args={[.18, .025, .33]} radius={.007} smoothness={3} position={[0, .035, 0]}>
        <meshStandardMaterial ref={material => { materials.current[i] = material }} color="#f3b354" emissive="#ff8b29" emissiveIntensity={.45} toneMapped={false} roughness={.35} />
      </RoundedBox>
    </group>)}
    {[-1, 1].map(side => <mesh key={side} position={[side * 1.04, .04, 1.30]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[.105, 24]} />
      <meshStandardMaterial color={CREAM} emissive="#e5b458" emissiveIntensity={.55} roughness={.3} />
    </mesh>)}
  </group>
}

export function PinballTable({ game }: { game: PinballGame }) {
  const playfield = useMemo(createPlayfieldTexture, [])
  const glass = useMemo(createGlassSheenTexture, [])
  useEffect(() => () => { playfield.dispose(); glass.dispose() }, [playfield, glass])
  return (
    <group>
      {/* Layered cabinet and its exposed brushed-metal lip. */}
      <RoundedBox args={[6.6, .62, 11.38]} position={[0, -.48, .05]} radius={.24} smoothness={5} castShadow receiveShadow>
        <meshStandardMaterial color="#141b19" metalness={.7} roughness={.32} />
      </RoundedBox>
      <RoundedBox args={[6.48, .11, 11.22]} position={[0, -.15, .025]} radius={.05} smoothness={4} castShadow>
        <meshStandardMaterial color="#8e9686" metalness={1} roughness={.29} />
      </RoundedBox>
      <RoundedBox args={[6.36, .18, 11.08]} position={[0, -.075, .025]} radius={.08} smoothness={4} receiveShadow>
        <meshStandardMaterial color="#212a23" metalness={.45} roughness={.34} />
      </RoundedBox>
      <mesh position={[0, .021, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[6.25, 10.8]} />
        <meshPhysicalMaterial map={playfield} roughness={.48} metalness={0} envMapIntensity={.18} clearcoat={.4} clearcoatRoughness={.28} />
      </mesh>

      {/* Raised machined sides carry a continuous recessed orange strip. */}
      {[-1, 1].map(side => <group key={side}>
        <RoundedBox args={[.22, .39, 10.94]} position={[side * 3.10, .14, 0]} radius={.07} smoothness={3} castShadow>
          <meshStandardMaterial color="#485447" metalness={.8} roughness={.35} />
        </RoundedBox>
        <RoundedBox args={[.027, .024, 10.48]} position={[side * 2.98, .225, 0]} radius={.006} smoothness={2}>
          <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={1.8} toneMapped={false} />
        </RoundedBox>
        <RoundedBox args={[.11, .15, 8.85]} position={[side * 3.30, -.47, .13]} radius={.049} smoothness={3}>
          <meshStandardMaterial color="#273127" metalness={.85} roughness={.32} />
        </RoundedBox>
      </group>)}
      <RoundedBox args={[6.18, .43, .28]} position={[0, .15, -5.30]} radius={.07} smoothness={4} castShadow>
        <meshStandardMaterial color="#4b5647" metalness={.85} roughness={.25} />
      </RoundedBox>
      <RoundedBox args={[5.6, .027, .038]} position={[0, .385, -5.22]} radius={.008} smoothness={3}>
        <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={2} toneMapped={false} />
      </RoundedBox>
      <RoundedBox args={[6.18, .20, .23]} position={[0, .07, 5.39]} radius={.065} smoothness={4} castShadow>
        <meshStandardMaterial color="#899180" metalness={1} roughness={.25} />
      </RoundedBox>

      {RAILS.map((rail, i) => <Rail key={i} {...rail} />)}
      <RailPosts />
      {BUMPERS.map((_, i) => <Bumper key={i} index={i} game={game} />)}
      <SlingshotPanel side={-1} />
      <SlingshotPanel side={1} />
      <Inserts game={game} />
      <LaunchGate game={game} />
      <Shooter game={game} />
      <Fasteners />
      <mesh position={[0, .62, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
        <planeGeometry args={[5.9, 10.5]} />
        <meshBasicMaterial map={glass} transparent opacity={.05} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
