import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BALL_RADIUS, FLIPPER_LENGTH, FLIPPER_RADIUS, FLIPPER_TIP_RADIUS, FLIPPER_PIVOT_Z, type PinballGame } from '../game/physics'
import type { PinballAudio } from '../game/audio'
import { PinballTable } from './PinballTable'
import { BallMesh, BallTrail, CameraRig, ImpactEffects, PostFX, SceneBoundary, StudioLights, WebGLFallback, useTimeScale, type SceneEvent } from './sceneKit'

interface GameSceneProps {
  game: PinballGame;
  audio: PinballAudio;
  cameraMode: 'angled' | 'top';
  quality: 'high' | 'balanced';
  onReady: () => void;
  onError: () => void;
}

function capsuleGeometry(radius: number, tipRadius: number, depth: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -radius);
  shape.lineTo(FLIPPER_LENGTH, -tipRadius);
  shape.absarc(FLIPPER_LENGTH, 0, tipRadius, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(0, radius);
  shape.absarc(0, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 2, curveSegments: 16 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function Flipper({ game, side }: { game: PinballGame; side: 'left' | 'right' }) {
  const ref = useRef<THREE.Group>(null);
  const geometry = useMemo(() => capsuleGeometry(FLIPPER_RADIUS - 0.012, FLIPPER_TIP_RADIUS - 0.012, 0.13), []);
  const cap = useMemo(() => capsuleGeometry(FLIPPER_RADIUS - 0.047, FLIPPER_TIP_RADIUS - 0.047, 0.032), []);
  useEffect(() => () => { geometry.dispose(); cap.dispose(); }, [geometry, cap]);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = side === 'left' ? -game.leftAngle : Math.PI + game.rightAngle;
  });
  return <group ref={ref} position={[side === 'left' ? -1.32 : 1.32, 0.075, FLIPPER_PIVOT_Z]}>
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#e54a24" roughness={0.43} metalness={0.05} emissive="#e9410e" emissiveIntensity={0.12} />
    </mesh>
    <mesh geometry={cap} position={[0, 0.147, 0]} castShadow>
      <meshPhysicalMaterial color="#eae3ce" roughness={0.24} metalness={0.33} clearcoat={0.8} clearcoatRoughness={0.2} />
    </mesh>
    <mesh position={[0, 0.19, 0]}>
      <cylinderGeometry args={[0.071, 0.071, 0.025, 24]} />
      <meshStandardMaterial color="#a7aca6" metalness={1} roughness={0.18} />
    </mesh>
    <mesh position={[0, 0.204, 0]}>
      <boxGeometry args={[0.062, 0.004, 0.011]} />
      <meshStandardMaterial color="#303c39" roughness={0.8} />
    </mesh>
    <mesh position={[0.85, 0.198, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.2, 0.035]} />
      <meshBasicMaterial color="#d84b25" />
    </mesh>
  </group>;
}


const SPARK_EVENTS = new Set(['bumper', 'sling', 'target', 'flipper', 'drop', 'kicker', 'kickout', 'wormhole', 'rank', 'multiball', 'jackpot'])
const RING_EVENTS = new Set(['bumper', 'sling', 'target', 'drop', 'kicker', 'kickout', 'wormhole', 'hyperspace', 'rank', 'mission', 'bonus', 'multiball', 'jackpot'])

function World({ game, audio, cameraMode, quality, onReady }: GameSceneProps) {
  const events = useRef<SceneEvent[]>([])
  const feel = useTimeScale()
  const getBalls = useMemo(() => (() => { const balls = [game.ball]; return () => balls })(), [game])
  useEffect(() => { onReady(); return () => audio.setRoll(0, 0) }, [onReady, audio])
  useFrame((_, delta) => {
    game.update(Math.min(delta, 0.05) * feel.step(delta))
    const next = game.consumeEvents()
    for (const event of next) {
      audio.play(event.type, { x: event.x, intensity: event.type === 'flipper' || event.type === 'wall' ? THREE.MathUtils.clamp((event.value ?? 4) / 12, 0.3, 1.2) : undefined })
      feel.impact(event)
    }
    events.current.push(...next)
    const snapshot = game.getSnapshot()
    let speed = 0, x = 0
    if (snapshot.status === 'playing' && !snapshot.launchReady ) {
      for (const ball of getBalls()) {
        if (ball.x > 2.44) continue
        const velocity = Math.hypot(ball.vx, ball.vz)
        if (velocity > speed) { speed = velocity; x = ball.x }
      }
    }
    audio.setRoll(Math.min(1, speed / 20), x)
  }, -1)
  return <>
    <CameraRig mode={cameraMode} shake={feel.shake} getBalls={getBalls} width={6.6} depth={11.4} centerZ={0.15} />
    <StudioLights quality={quality} variant="orbital" width={6.6} depth={11.4} />
    <PinballTable game={game} />
    <Flipper game={game} side="left" /><Flipper game={game} side="right" />
    <BallMesh getBalls={getBalls} radius={BALL_RADIUS} maxBalls={1} />
    <BallTrail getBalls={getBalls} color="#ff8c36" />
    
    <ImpactEffects events={events} quality={quality} sparkEvents={SPARK_EVENTS} ringEvents={RING_EVENTS} sparkColor={[3.2, 1.5, .26]} ringColor={[1.3, .45, .12]} />
    <PostFX quality={quality} variant="orbital" />
  </>
}

export function GameScene(props: GameSceneProps) {
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
