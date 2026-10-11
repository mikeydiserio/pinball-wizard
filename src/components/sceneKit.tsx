import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'

type Quality = 'high' | 'balanced'
type Variant = 'orbital' | 'cadet' | 'volcano'
export interface SceneBall { x: number; y?: number; z: number; vx: number; vz: number }
export interface SceneEvent { type: string; x: number; z: number; value?: number }
type BallSource = () => readonly SceneBall[]
const EMPTY_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0)
const TRAIL_POINTS = 22
const PARTICLE_COUNT = 140
const RING_COUNT = 14

// Canvas also mounts its fallback as canvas children when WebGL succeeds.
// Reporting failures belongs exclusively to the boundary.
export function WebGLFallback() {
  return <div className="webgl-fallback" role="alert" style={{ padding: '2rem', color: '#f5f0df', textAlign: 'center' }}>
    <strong>The arcade needs WebGL.</strong>
    <p>Enable hardware acceleration in your browser, then reload to play.</p>
  </div>
}

export class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? <WebGLFallback /> : this.props.children }
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export function CameraRig({ mode, shake, getBalls, width, depth, centerZ }: {
  mode: 'angled' | 'top'; shake: RefObject<number>; getBalls: BallSource; width: number; depth: number; centerZ: number
}) {
  const { camera, size } = useThree()
  const reducedMotion = useReducedMotion()
  const state = useMemo(() => ({
    target: new THREE.Vector3(0, 0, centerZ), desired: new THREE.Vector3(), projected: new THREE.Vector3(),
    direction: new THREE.Vector3(), look: new THREE.Vector3(), elevation: 0, distance: 0, initialized: false,
    // Include the cabinet front and raised rail tops, not only the flat playfield.
    corners: [-width / 2, width / 2].flatMap(x => [-0.8, 0.8].flatMap(y =>
      [-depth / 2 + centerZ, depth / 2 + centerZ].map(z => new THREE.Vector3(x, y, z)))),
  }), [width, depth, centerZ])
  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera
    const ball = getBalls()[0]
    const immediate = reducedMotion || !state.initialized
    const ease = immediate ? 1 : 1 - Math.exp(-delta * 5)
    state.desired.set(reducedMotion ? 0 : (ball?.x ?? 0) * 0.05, 0,
      centerZ + (reducedMotion ? 0 : THREE.MathUtils.clamp((ball?.z ?? 0) * 0.12, -0.8, 0.8)))
    state.target.lerp(state.desired, immediate ? 1 : 1 - Math.exp(-delta * 3))
    state.elevation = THREE.MathUtils.lerp(state.elevation, THREE.MathUtils.degToRad(mode === 'top' ? 89 : 52), ease)
    state.direction.set(0, Math.sin(state.elevation), Math.cos(state.elevation))
    cam.aspect = size.width / Math.max(size.height, 1)
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    let distance = Math.max((depth / 2 * Math.sin(state.elevation) + 0.45) / tan, (width / 2 + 0.45) / (tan * cam.aspect))
    const impulse = reducedMotion ? 0 : shake.current
    state.look.copy(state.target)
    state.look.x += Math.sin(performance.now() * 0.055) * impulse
    state.look.z += impulse
    cam.up.set(0, 0, -1)
    cam.far = Math.max(80, distance + depth + 20)
    cam.updateProjectionMatrix()
    // Perspective enlarges the near cabinet corners. Project them and expand the
    // distance until every corner is inside the safe frame, including during orbit changes.
    for (let pass = 0; pass < 8; pass++) {
      cam.position.copy(state.target).addScaledVector(state.direction, distance)
      cam.lookAt(state.look)
      cam.updateMatrixWorld()
      let extent = 0
      for (const corner of state.corners) {
        state.projected.copy(corner).project(cam)
        extent = Math.max(extent, Math.abs(state.projected.x), Math.abs(state.projected.y))
      }
      if (extent <= 0.96) break
      distance *= extent / 0.96 + 0.005
    }
    // Zooming out takes priority over easing so resize/follow never crops the cabinet.
    state.distance = Math.max(distance, THREE.MathUtils.lerp(state.distance, distance, ease))
    cam.position.copy(state.target).addScaledVector(state.direction, state.distance)
    cam.far = Math.max(80, state.distance + depth + 20)
    cam.lookAt(state.look)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    shake.current *= Math.exp(-delta * 20)
    state.initialized = true
  })
  return null
}

const SHAKE: Record<string, number> = {
  nudge: 0.07, bumper: 0.018, kicker: 0.02, sling: 0.012, ramp: 0.02, wormhole: 0.02,
  mission: 0.04, hyperspace: 0.04, multiball: 0.04, jackpot: 0.04, rank: 0.06, drain: 0.02, eruption: 0.07,
}

export function useTimeScale() {
  const reducedMotion = useReducedMotion()
  const remaining = useRef(0)
  const shake = useRef(0)
  return {
    shake,
    step(delta: number) {
      if (reducedMotion) { remaining.current = 0; shake.current = 0; return 1 }
      remaining.current = Math.max(0, remaining.current - delta)
      return 1 - 0.6 * (remaining.current / 0.25) ** 2
    },
    impact(event: SceneEvent) {
      if (reducedMotion) return
      shake.current = Math.max(shake.current, SHAKE[event.type] ?? (event.type === 'flipper' && (event.value ?? 0) > 8 ? 0.01 : 0))
      if (['rank', 'jackpot', 'multiball', 'eruption'].includes(event.type)) remaining.current = 0.25
    },
  }
}

/** Per-table light rig: sky, fill, rim spot, and the two tinted environment strips. */
const LIGHT_RIGS: Record<Variant, { sky: string; ground: string; key: string; fill: string; spot: string; strip: string; front: string }> = {
  orbital: { sky: '#cdd5ce', ground: '#454335', key: '#fff0cf', fill: '#b6d8d0', spot: '#ffc288', strip: '#e8f2eb', front: '#ffc78f' },
  cadet: { sky: '#c9d4ff', ground: '#2a2445', key: '#f2f0ff', fill: '#9fb4ff', spot: '#c38bff', strip: '#b9a6ff', front: '#99b9ff' },
  volcano: { sky: '#ffd2b0', ground: '#3a160b', key: '#fff0dc', fill: '#ff9a5c', spot: '#ff5a1f', strip: '#ffb07a', front: '#ff8a4a' },
}

export function StudioLights({ quality, variant, width, depth }: { quality: Quality; variant: Variant; width: number; depth: number }) {
  const rig = LIGHT_RIGS[variant]
  return <>
    <ambientLight intensity={0.25} />
    <hemisphereLight args={[rig.sky, rig.ground, 0.65]} />
    <directionalLight position={[-3.5, 10, 3]} color={rig.key} intensity={1.7} castShadow
      shadow-mapSize={[quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024]}
      shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={8} shadow-camera-bottom={-8}
      shadow-camera-near={0.5} shadow-camera-far={25} shadow-normalBias={0.012} shadow-bias={-0.0001} />
    <directionalLight position={[4, 5, -4]} color={rig.fill} intensity={0.55} />
    <spotLight position={[0, 6, -6]} color={rig.spot} intensity={14} angle={0.75} penumbra={1} distance={22} />
    <Environment resolution={256} frames={1} environmentIntensity={0.3}>
      <Lightformer form="rect" intensity={3} position={[0, 7, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[4, 13, 1]} />
      <Lightformer form="rect" intensity={4} position={[-5, 3, 0]} rotation={[0, Math.PI / 2, 0]} scale={[1.8, 9, 1]} />
      <Lightformer form="rect" color={rig.strip} intensity={1.1} position={[5, 4, -2]} rotation={[0, -Math.PI / 2, 0]} scale={[2, 11, 1]} />
      <Lightformer form="rect" color={rig.front} intensity={2} position={[0, 4, 8]} rotation={[0, Math.PI, 0]} scale={[7, 2, 1]} />
      <Lightformer form="ring" intensity={2} position={[0, 5, -9]} scale={4} />
    </Environment>
    <ContactShadows position={[0, -0.8, 0]} scale={[width + 2, depth + 2]} blur={2.5} opacity={0.55} far={2} resolution={512} frames={1} color="#000000" />
  </>
}

function SingleBall({ getBalls, index, radius }: { getBalls: BallSource; index: number; radius: number }) {
  const ball = useRef<THREE.Mesh>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const shadowMaterial = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ scene }, delta) => {
    const source = getBalls()[index]
    if (!ball.current || !shadow.current) return
    ball.current.visible = !!source
    shadow.current.visible = !!source
    if (!source) return
    // An explicit map gives the chrome ball its own reflection intensity;
    // materials using scene.environment inherit the softer table lighting.
    const material = ball.current.material as THREE.MeshStandardMaterial
    if (material.envMap !== scene.environment) {
      material.envMap = scene.environment
      material.needsUpdate = true
    }
    const y = source.y === undefined ? 0.021 + radius : source.y - 0.05
    ball.current.position.set(source.x, y, source.z)
    ball.current.rotation.x += source.vz * delta / radius
    ball.current.rotation.z -= source.vx * delta / radius
    const lift = Math.max(0, y - 0.021 - radius)
    shadow.current.position.set(source.x + 0.025 + lift * 0.25, 0.027, source.z + 0.025 + lift * 0.15)
    shadow.current.scale.setScalar(1 + lift * 0.3)
    if (shadowMaterial.current) shadowMaterial.current.opacity = y < 0.1 ? 0 : 0.42 / (1 + lift * 3)
  })
  return <>
    <mesh ref={ball} castShadow visible={false}>
      <sphereGeometry args={[radius, 48, 32]} />
      <meshStandardMaterial color="#f6faf8" metalness={1} roughness={0.07} envMapIntensity={2.2} />
    </mesh>
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <circleGeometry args={[0.17, 32]} />
      <meshBasicMaterial ref={shadowMaterial} color="#01030a" transparent opacity={0.42} depthWrite={false} />
    </mesh>
  </>
}

export function BallMesh({ getBalls, radius, maxBalls = 1 }: { getBalls: BallSource; radius: number; maxBalls?: number }) {
  return <>{Array.from({ length: maxBalls }, (_, index) => <SingleBall key={index} getBalls={getBalls} index={index} radius={radius} />)}</>
}

export function BallTrail({ getBalls, index = 0, color }: { getBalls: BallSource; index?: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null)
  const reducedMotion = useReducedMotion()
  const state = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(TRAIL_POINTS * 6)
    const colors = new Float32Array(TRAIL_POINTS * 6)
    const tint = new THREE.Color(color)
    const indices: number[] = []
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const brightness = Math.pow(1 - i / TRAIL_POINTS, 1.6)
      for (let j = 0; j < 2; j++) tint.toArray(colors, i * 6 + j * 3)
      for (let j = 0; j < 6; j++) colors[i * 6 + j] *= brightness
      if (i < TRAIL_POINTS - 1) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    return { geometry, positions, history: Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector3()), tick: 0, active: false }
  }, [color])
  useEffect(() => () => state.geometry.dispose(), [state])
  useFrame((_, delta) => {
    const source = getBalls()[index]
    if (ref.current) ref.current.visible = !!source && !reducedMotion && (source.y === undefined || source.y >= 0.15)
    if (!source || reducedMotion) { state.active = false; return }
    const { history, positions, geometry } = state
    const y = source.y === undefined ? 0.12 : source.y - 0.11
    if (!state.active || Math.hypot(history[0].x - source.x, history[0].z - source.z) > 1.4) history.forEach(p => p.set(source.x, y, source.z))
    state.active = true
    state.tick += delta
    if (state.tick >= 0.011) {
      for (let i = TRAIL_POINTS - 1; i > 0; i--) history[i].copy(history[i - 1])
      history[0].set(source.x, y, source.z)
      state.tick = 0
    }
    const speed = Math.min(Math.hypot(source.vx, source.vz) / 7, 1)
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const next = history[Math.min(i + 1, TRAIL_POINTS - 1)]
      const prev = history[Math.max(i - 1, 0)]
      const dx = next.x - prev.x, dz = next.z - prev.z
      const scale = 0.048 * speed * (1 - i / TRAIL_POINTS) / (Math.hypot(dx, dz) || 1)
      const off = i * 6
      positions[off] = history[i].x - dz * scale
      positions[off + 1] = history[i].y
      positions[off + 2] = history[i].z + dx * scale
      positions[off + 3] = history[i].x + dz * scale
      positions[off + 4] = history[i].y
      positions[off + 5] = history[i].z - dx * scale
    }
    geometry.attributes.position.needsUpdate = true
  })
  return <mesh ref={ref} geometry={state.geometry} frustumCulled={false} visible={false}>
    <meshBasicMaterial vertexColors transparent opacity={0.45} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
  </mesh>
}

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }
interface Ring { x: number; z: number; life: number; duration: number }

export function ImpactEffects({ events, quality, sparkEvents, ringEvents, sparkColor, ringColor }: {
  events: RefObject<SceneEvent[]>; quality: Quality; sparkEvents: ReadonlySet<string>; ringEvents: ReadonlySet<string>;
  sparkColor: readonly [number, number, number]; ringColor: readonly [number, number, number]
}) {
  const sparks = useRef<THREE.InstancedMesh>(null)
  const rings = useRef<THREE.InstancedMesh>(null)
  const reducedMotion = useReducedMotion()
  const state = useMemo(() => ({
    particles: Array.from({ length: PARTICLE_COUNT }, (): Particle => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 })),
    rings: Array.from({ length: RING_COUNT }, (): Ring => ({ x: 0, z: 0, life: 0, duration: 1 })),
    particleCursor: 0, ringCursor: 0, dummy: new THREE.Object3D(), color: new THREE.Color(),
  }), [])
  useFrame((_, delta) => {
    if (!sparks.current || !rings.current) return
    for (const event of events.current.splice(0)) {
      if (sparkEvents.has(event.type)) {
        const count = reducedMotion ? 0 : event.type === 'flipper' ? 4 : ['rank', 'multiball', 'jackpot'].includes(event.type) ? 30 : quality === 'high' ? 11 : 6
        for (let i = 0; i < count; i++) {
          const p = state.particles[state.particleCursor++ % PARTICLE_COUNT]
          const angle = Math.random() * Math.PI * 2, speed = 1.2 + Math.random() * 2.8
          p.x = event.x; p.z = event.z; p.y = 0.2
          p.vx = Math.cos(angle) * speed; p.vz = Math.sin(angle) * speed
          p.vy = 0.9 + Math.random() * 1.4; p.life = 0.23 + Math.random() * 0.26
        }
      }
      if (ringEvents.has(event.type)) {
        const ring = state.rings[state.ringCursor++ % RING_COUNT]
        ring.x = event.x; ring.z = event.z
        ring.life = ring.duration = reducedMotion ? 0.13 : ['rank', 'hyperspace', 'jackpot', 'multiball'].includes(event.type) ? 0.6 : 0.3
      }
    }
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = state.particles[i]
      p.life -= delta
      if (p.life <= 0 || reducedMotion) { sparks.current.setMatrixAt(i, EMPTY_MATRIX); continue }
      p.x += p.vx * delta; p.y += p.vy * delta; p.z += p.vz * delta; p.vy -= 7 * delta
      state.dummy.position.set(p.x, Math.max(0.065, p.y), p.z)
      state.dummy.rotation.set(0, 0, 0)
      state.dummy.scale.setScalar(Math.min(1, p.life * 7))
      state.dummy.updateMatrix()
      sparks.current.setMatrixAt(i, state.dummy.matrix)
      state.color.setRGB(...sparkColor).multiplyScalar(0.85 + (i % 3) * 0.15)
      sparks.current.setColorAt(i, state.color)
    }
    for (let i = 0; i < RING_COUNT; i++) {
      const ring = state.rings[i]
      ring.life -= delta
      if (ring.life <= 0) { rings.current.setMatrixAt(i, EMPTY_MATRIX); continue }
      const t = 1 - ring.life / ring.duration
      state.dummy.position.set(ring.x, 0.045, ring.z)
      state.dummy.rotation.set(-Math.PI / 2, 0, 0)
      state.dummy.scale.setScalar(reducedMotion ? 1 : 1 + t * 3)
      state.dummy.updateMatrix()
      rings.current.setMatrixAt(i, state.dummy.matrix)
      state.color.setRGB(...ringColor).multiplyScalar(1 - t)
      rings.current.setColorAt(i, state.color)
    }
    sparks.current.instanceMatrix.needsUpdate = true
    rings.current.instanceMatrix.needsUpdate = true
    if (sparks.current.instanceColor) sparks.current.instanceColor.needsUpdate = true
    if (rings.current.instanceColor) rings.current.instanceColor.needsUpdate = true
  })
  return <>
    <instancedMesh ref={sparks} args={[undefined, undefined, PARTICLE_COUNT]} frustumCulled={false}>
      <sphereGeometry args={[0.023, 5, 4]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
    <instancedMesh ref={rings} args={[undefined, undefined, RING_COUNT]} frustumCulled={false}>
      <ringGeometry args={[0.205, 0.224, 40]} />
      <meshBasicMaterial toneMapped={false} transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
    </instancedMesh>
  </>
}

export function PostFX({ quality, variant }: { quality: Quality; variant: Variant }) {
  const gl = useThree(state => state.gl)
  useLayoutEffect(() => {
    gl.toneMapping = quality === 'high' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
  }, [gl, quality])
  if (quality !== 'high') return null
  return <EffectComposer multisampling={4}>
    <Bloom intensity={variant === 'orbital' ? 0.55 : variant === 'cadet' ? 0.7 : 0.8} luminanceThreshold={0.7} luminanceSmoothing={0.4} mipmapBlur radius={0.6} />
    <Vignette offset={0.3} darkness={0.55} />
    <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
  </EffectComposer>
}
