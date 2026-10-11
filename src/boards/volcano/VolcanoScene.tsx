import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BALL_RADIUS, FLIPPER, LAVA } from './layout'
import type { VolcanoEventType, VolcanoGame } from './game'
import type { PinballAudio } from '../../game/audio'
import { VolcanoTable } from './VolcanoTable'
import { BallMesh, BallTrail, CameraRig, ImpactEffects, PostFX, SceneBoundary, StudioLights, WebGLFallback, useTimeScale, type SceneEvent } from '../../components/sceneKit'

interface SceneProps {
  game: VolcanoGame
  audio: PinballAudio
  cameraMode: 'angled' | 'top'
  quality: 'high' | 'balanced'
  onReady: () => void
  onError: () => void
}

/** Volcano events reuse the shared sound and shake vocabulary where one fits. */
const CUES: Partial<Record<VolcanoEventType, string>> = { tube: 'wormhole', expedition: 'mission', chamber: 'jackpot' }

function capsuleGeometry(radius: number, tipRadius: number, depth: number) {
  const shape = new THREE.Shape()
  shape.moveTo(0, -radius)
  shape.lineTo(FLIPPER.length, -tipRadius)
  shape.absarc(FLIPPER.length, 0, tipRadius, -Math.PI / 2, Math.PI / 2, false)
  shape.lineTo(0, radius)
  shape.absarc(0, 0, radius, Math.PI / 2, Math.PI * 1.5, false)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 2, curveSegments: 16 })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** Obsidian bats with molten-orange rubbers. */
function Flipper({ game, side }: { game: VolcanoGame; side: 'left' | 'right' }) {
  const ref = useRef<THREE.Group>(null)
  const rubber = useMemo(() => capsuleGeometry(FLIPPER.radius - 0.008, FLIPPER.tipRadius - 0.008, 0.09), [])
  const body = useMemo(() => capsuleGeometry(FLIPPER.radius - 0.04, FLIPPER.tipRadius - 0.04, 0.05), [])
  useEffect(() => () => { rubber.dispose(); body.dispose() }, [rubber, body])
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = side === 'left' ? -game.leftAngle : Math.PI + game.rightAngle
  })
  return <group ref={ref} position={[side === 'left' ? FLIPPER.leftX : FLIPPER.rightX, 0.06, FLIPPER.pivotZ]}>
    <mesh geometry={rubber} castShadow receiveShadow>
      <meshStandardMaterial color={LAVA.orange} roughness={0.55} emissive="#c4280f" emissiveIntensity={0.35} />
    </mesh>
    <mesh geometry={body} position={[0, 0.1, 0]} castShadow>
      <meshPhysicalMaterial color="#17101c" roughness={0.12} clearcoat={1} clearcoatRoughness={0.1} />
    </mesh>
    <mesh position={[0, 0.17, 0]}>
      <cylinderGeometry args={[0.065, 0.065, 0.03, 20]} />
      <meshStandardMaterial color={LAVA.amber} emissive={LAVA.orange} emissiveIntensity={.6} metalness={.6} roughness={0.3} />
    </mesh>
  </group>
}

const SPARK_EVENTS = new Set(['bumper', 'sling', 'target', 'flipper', 'drop', 'kicker', 'kickout', 'tube', 'rank', 'eruption', 'chamber'])
const RING_EVENTS = new Set(['bumper', 'sling', 'target', 'drop', 'kicker', 'kickout', 'tube', 'eruption', 'chamber', 'rank', 'expedition', 'bonus'])

function World({ game, audio, cameraMode, quality, onReady }: SceneProps) {
  const events = useRef<SceneEvent[]>([])
  const feel = useTimeScale()
  const getBalls = useMemo(() => () => game.balls, [game])
  useEffect(() => { onReady(); return () => audio.setRoll(0, 0) }, [onReady, audio])
  useFrame((_, delta) => {
    game.update(Math.min(delta, 0.05) * feel.step(delta))
    const next = game.consumeEvents()
    for (const event of next) {
      const cue = CUES[event.type] ?? event.type
      audio.play(cue, { x: event.x, intensity: event.type === 'flipper' || event.type === 'wall' ? THREE.MathUtils.clamp((event.value ?? 4) / 12, 0.3, 1.2) : undefined })
      feel.impact({ ...event, type: cue })
    }
    events.current.push(...next)
    const snapshot = game.getSnapshot()
    const ball = game.ball
    const rolling = snapshot.status === 'playing' && !snapshot.launchReady && !snapshot.bonus && ball.x <= 2.85 && ball.y <= 0.3 && ball.y >= 0.15
    audio.setRoll(rolling ? Math.min(1, Math.hypot(ball.vx, ball.vz) / 20) : 0, ball.x)
  }, -1)
  return <>
    <CameraRig mode={cameraMode} shake={feel.shake} getBalls={getBalls} width={7.6} depth={13.3} centerZ={0.2} />
    <StudioLights quality={quality} variant="volcano" width={7.6} depth={13.3} />
    <VolcanoTable game={game} />
    <Flipper game={game} side="left" /><Flipper game={game} side="right" />
    <BallMesh getBalls={getBalls} radius={BALL_RADIUS} maxBalls={1} />
    <BallTrail getBalls={getBalls} color={LAVA.orange} />
    <ImpactEffects events={events} quality={quality} sparkEvents={SPARK_EVENTS} ringEvents={RING_EVENTS} sparkColor={[3.6, 1.5, .35]} ringColor={[1.9, .7, .2]} />
    <PostFX quality={quality} variant="volcano" />
  </>
}

export function VolcanoScene(props: SceneProps) {
  return <div className="game-canvas" style={{ width: '100%', height: '100%' }}>
    <SceneBoundary onError={props.onError}>
      <Canvas camera={{ position: [0, 20, 14], fov: 32, near: 0.5, far: 100 }}
        dpr={props.quality === 'high' ? [1, 1.75] : 1} shadows
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMappingExposure: 1.03 }}
        fallback={<WebGLFallback />}>
        <Suspense fallback={null}><World {...props} /></Suspense>
      </Canvas>
    </SceneBoundary>
  </div>
}
