import { MISSIONS, missionsForRank, type MissionKind } from './missions'
export { MISSIONS } from './missions'
import type { TableGame, TableSnapshot } from '../../game/table'
import {
  BALL_RADIUS, BALL_Y, BUMPERS, CENTER_POST, DRAIN_Z, DROPS, FLIPPER, GRAVITY_WELL, KICKERS, OUTLANE_DRAIN_Z,
  DECK_Y, DECK_RAILS, onLaunchDeck, RAMP_ENTRY, RAMP_PATH, ROLLOVERS, SAUCERS, SEGMENTS, SERVE, SPINNERS, TABLE, TARGETS, WORMHOLES,
  isOutlane, type LightKey, type Segment, type Vec3,
} from './layout'

export type CadetEventType =
  | 'bumper' | 'sling' | 'flipper' | 'launch' | 'drain' | 'nudge' | 'target' | 'tilt'
  | 'ramp' | 'wormhole' | 'kickout' | 'rollover' | 'drop' | 'spinner' | 'rank' | 'mission'
  | 'kicker' | 'hyperspace' | 'bonus' | 'wall' | 'multiball' | 'jackpot' | 'drainBall' | 'bonusTick'
export interface CadetBall { x: number; y: number; z: number; vx: number; vz: number }
export interface CadetEvent { id: number; type: CadetEventType; x: number; z: number; value?: number }

export const RANKS = ['Cadet', 'Ensign', 'Lieutenant', 'Captain', 'Lt. Commander', 'Commander', 'Commodore', 'Admiral', 'Fleet Admiral'] as const

export type CadetSnapshot = TableSnapshot & Readonly<{
  rank: number
  rankProgress: number
  selectedMission: number | null
  missionStage: number
  replay: boolean
  mission: number | null
  missionProgress: number
  missionReady: boolean
  fuel: number
  hyperspace: number
  extraBalls: number
  multiball: boolean
  bonus: { count: number; total: number; multiplier: number } | null
}>

type Capture =
  | { kind: 'ramp'; distance: number; speed: number }
  | { kind: 'saucer'; index: number; until: number }
  | { kind: 'wormhole'; from: number; to: number; phase: 'sink' | 'rise'; until: number }
  | { kind: 'well'; until: number }
  | { kind: 'bonusLane'; progress: number }
  | { kind: 'deploy'; until: number; power?: number }

const STEP = 1 / 240
const GRAVITY = 4.7
const MAX_SPEED = 20
const BEST_KEY = 'space-cadet-pinball-best'
const HYPERSPACE_AWARDS = [10_000, 20_000, 20_000, 50_000, 150_000]
const MULTIPLIERS = [1, 2, 3, 5, 10]
const SKILL_AWARDS = [15_000, 30_000, 75_000, 30_000, 15_000, 7_500]
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Precomputed arc-length table for the elevated launch ramp. */
const RAMP = (() => {
  const lengths = [0]
  for (let i = 1; i < RAMP_PATH.length; i++) {
    const [ax, ay, az] = RAMP_PATH[i - 1]
    const [bx, by, bz] = RAMP_PATH[i]
    lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay, bz - az))
  }
  return { lengths, total: lengths[lengths.length - 1] }
})()

export function sampleRamp(distance: number): Vec3 {
  const d = clamp(distance, 0, RAMP.total)
  let i = 1
  while (i < RAMP.lengths.length - 1 && RAMP.lengths[i] < d) i++
  const t = (d - RAMP.lengths[i - 1]) / (RAMP.lengths[i] - RAMP.lengths[i - 1] || 1)
  const a = RAMP_PATH[i - 1]
  const b = RAMP_PATH[i]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

interface BallState {
  capture: Capture | null
  captureCooldown: number
  onDeck: boolean
  verticalSpeed: number
  stillSince: number
  wellInside: boolean
  rolloverInside: boolean[]
  kickerInside: boolean[]
  launchTime: number
  deploying: boolean
  deploymentLights: number
  deckLane: boolean
}

const freshBallState = (): BallState => ({
  capture: null, captureCooldown: 0, onDeck: false, verticalSpeed: 0, stillSince: 0, wellInside: false,
  rolloverInside: ROLLOVERS.map(() => false), kickerInside: KICKERS.map(() => false), launchTime: -10, deploying: false, deploymentLights: 0, deckLane: false,
})

/** Fixed-step simulation of the Space Cadet table. Renderers read public fields each frame. */
export class SpaceCadetGame implements TableGame {
  readonly balls: CadetBall[] = [{ x: SERVE.x, y: BALL_Y, z: SERVE.z, vx: 0, vz: 0 }]
  get ball(): CadetBall { return this.balls[0] }
  private current = this.balls[0]
  private ballStates = new WeakMap<CadetBall, BallState>([[this.current, freshBallState()]])
  private get currentState(): BallState { return this.ballStates.get(this.current)! }
  leftAngle: number = FLIPPER.rest
  rightAngle: number = FLIPPER.rest
  charge = 0
  centerPostUp = false
  readonly bumperFlashes = BUMPERS.map(() => 0)
  readonly targetFlashes = TARGETS.map(() => 0)
  readonly targetLit = TARGETS.map(() => false)
  readonly dropsDown = DROPS.map(() => false)
  readonly rolloverFlashes = ROLLOVERS.map(() => 0)
  readonly reentryLit = [false, false, false]
  readonly spinnerAngles = SPINNERS.map(() => 0)
  readonly kickersArmed = [false, false]
  readonly saucerFlashes = SAUCERS.map(() => 0)
  readonly wormholeFlashes = WORMHOLES.map(() => 0)
  readonly slingFlashes = [0, 0]

  private state: CadetSnapshot
  private listeners = new Set<() => void>()
  private events: CadetEvent[] = []
  private eventId = 0
  private accumulator = 0
  private elapsed = 0
  private charging = false
  private leftPressed = false
  private rightPressed = false
  private savedStatus: TableSnapshot['status'] = 'ready'
  private saveUntil = 0
  private wallUntil = 0
  private bonusElapsed = 0
  private bonusTickAt = 0
  private comboUntil = 0
  private messageUntil = 0
  private lastNudge = -10
  private nudges: number[] = []
  private bumperCooldowns = BUMPERS.map(() => 0)
  private targetCooldowns = TARGETS.map(() => 0)
  private slingUntil = 0
  private flipperUntil = [0, 0]
  private get rolloverInside(): boolean[] { return this.currentState.rolloverInside }
  private set rolloverInside(value: boolean[]) { this.currentState.rolloverInside = value }
  private get kickerInside(): boolean[] { return this.currentState.kickerInside }
  private set kickerInside(value: boolean[]) { this.currentState.kickerInside = value }
  private spinnerVelocity = SPINNERS.map(() => 0)
  private spinnerHalfTurns = SPINNERS.map(() => 0)
  private dropResetAt = [0, 0, 0]
  private get capture(): Capture | null { return this.currentState.capture }
  private set capture(value: Capture | null) { this.currentState.capture = value }
  private get captureCooldown(): number { return this.currentState.captureCooldown }
  private set captureCooldown(value: number) { this.currentState.captureCooldown = value }
  private get wellInside(): boolean { return this.currentState.wellInside }
  private set wellInside(value: boolean) { this.currentState.wellInside = value }
  private wellCooldown = 0
  private get stillSince(): number { return this.currentState.stillSince }
  private set stillSince(value: number) { this.currentState.stillSince = value }
  private fuelDrainAt = 0
  private reflexUntil = 0
  private hyperReflexUntil = 0
  private extraBallUntil = 0
  private centerPostUntil = 0
  private hyperspaceUntil = 0
  private attackUntil = 0
  private engineUntil = 0
  private multiplierUntil = 0
  private medalUntil = 0
  private flagsUntil = 0
  private boosterUntil = [0, 0, 0, 0]
  readonly engineLit = [false, false, false]
  readonly fuelLit = [true, true, true, true, true, true]
  readonly returnLit = [false, false]
  attackLevel = 0
  engineLevel = 0
  medalLevel = 0
  wormholeOpen = false
  wormholeExit = 0
  gravityActive = false
  private bonusLit = false
  private replayAwarded = false
  private replayBall = false
  private bonusValue = 10_000
  private jackpotValue = 20_000
  private best = 0
  private randomState = 0x5ca7c0de

  constructor() {
    try {
      const stored = Number(globalThis.localStorage?.getItem(BEST_KEY))
      if (Number.isFinite(stored) && stored >= 0) this.best = Math.floor(stored)
    } catch { /* Storage can be disabled. */ }
    this.state = Object.freeze(this.freshSnapshot())
  }

  private freshSnapshot(): CadetSnapshot {
    return {
      status: 'ready', score: 0, best: this.best, ballNumber: 1, multiplier: 1, combo: 0, charge: 0,
      message: 'HOLD SPACE TO LAUNCH', launchReady: true, hits: 0, ballSave: false, tilted: false,
      rank: 0, rankProgress: 0, selectedMission: null, missionStage: 0, replay: false, mission: null, missionProgress: 0, missionReady: false, fuel: 6, hyperspace: 0, extraBalls: 0, multiball: false, bonus: null,
    }
  }

  getSnapshot = (): CadetSnapshot => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  consumeEvents(): CadetEvent[] {
    const events = this.events
    this.events = []
    return events
  }

  /** Light level from 0 to 1 for each playfield insert. */
  lightLevel(key: LightKey, index = 0): number {
    const s = this.state
    const blink = (rate = 4) => (Math.sin(this.elapsed * Math.PI * rate) > 0 ? 1 : 0.15)
    const on = (value: boolean) => (value ? 1 : 0)
    if (s.tilted && key !== 'tilt') return 0
    switch (key) {
      case 'fuel': return on(this.fuelLit[index]) * (index === this.fuelLit.lastIndexOf(true) && this.fuelDrainAt - this.elapsed < 2 ? blink(5) : 1)
      case 'fuelTarget': return on(this.targetLit[index])
      case 'fieldMultiplier': return on(index < MULTIPLIERS.indexOf(s.multiplier))
      case 'spaceWarp': return on(this.returnLit.some(Boolean))
      case 'hazard': return on(this.targetLit[7 + index])
      case 'reentry': return on(this.reentryLit[index])
      case 'launchLanes': return on(this.engineLit[index])
      case 'reflex': return this.elapsed < (index ? this.hyperReflexUntil : this.reflexUntil) ? blink(5) : 0
      case 'timeWarp': return s.mission === 15 && s.missionStage === 1 ? blink(3) : 0
      case 'missionAccept': return s.missionReady && s.fuel > 0 ? blink(3) : 0
      case 'missionTarget': return on(this.targetLit[3 + index])
      case 'tilt': return on(s.tilted)
      case 'extraBall': return this.elapsed < this.extraBallUntil ? blink(2) : 0
      case 'bonusLane': return on(this.bonusLit)
      case 'returnLane': return on(this.returnLit[index])
      case 'outLane': return on(this.elapsed < this.extraBallUntil)
      case 'kicker': return on(this.kickersArmed[index])
      case 'replay': return on(this.replayAwarded)
      case 'hyperspace': return on(index < s.hyperspace)
      case 'hyperspaceKickout': return this.saucerFlashes[0]
      case 'blackHole': return this.saucerFlashes[1]
      case 'escape': return this.saucerFlashes[2]
      case 'wormhole': return Math.max(this.wormholeFlashes[index], on(this.wormholeOpen))
      case 'wormholeExit': return on(this.wormholeOpen)
      case 'spaceWarpTarget': return on(this.wormholeOpen)
      case 'medal': return on(index < this.medalLevel)
      case 'maelstrom': return s.mission === 16 ? blink(4) : 0
      case 'deployment': return !this.replayBall ? on(index < this.currentState.deploymentLights) : 0
      case 'deploymentArrow': return s.launchReady && !this.replayBall ? on(Math.floor(this.elapsed * 8) % 9 === index) : 0
      case 'booster': return on(this.boosterUntil[index] > this.elapsed)
      case 'flag': return on(this.flagsUntil > this.elapsed)
      case 'rank': return on(index <= s.rank)
      case 'progress': return on(index < s.rankProgress)
      case 'redeploy': return s.ballSave ? (this.saveUntil - this.elapsed < 3 ? blink(8) : 1) : 0
      case 'gravity': return this.gravityActive ? blink(3) : 0
      case 'centerPost': return this.centerPostUp ? this.centerPostUntil - this.elapsed < 3 ? blink(5) : 1 : 0
      case 'missionArrow': {
        if (s.mission === null) return 0
        const step = MISSIONS[s.mission].steps[s.missionStage]
        if (step.requires === 'attack' && !this.attackLevel) return index === 1 ? blink(3) : 0
        if (step.requires === 'engine' && !this.engineLevel) return index === 0 || index === 13 ? blink(3) : 0
        if (step.requires === 'flags' && this.flagsUntil <= this.elapsed) return index === 3 ? blink(3) : 0
        const arrows: Partial<Record<MissionKind, number[]>> = {
          ramp: [0], reentry: [1], bumper: [2, 10], satellite: [10], drop: [3], spot: [4, 5], target: [3, 4, 5],
          lane: [0, 1, 11, 12], out: [11, 12], flags: [17], spaceWarp: [9], fuel: [8],
          wormhole: [14, 15, 16], green: [14], red: [15], yellow: [16], hyperspace: [6], blackHole: [7],
          radiation: [4], comet: [5], rebound: [18], timeWarp: [0, 6],
        }
        return arrows[step.kind]?.includes(index) ? blink(3) : 0
      }
    }
  }

  private patch(change: Partial<CadetSnapshot>): void {
    if (Object.entries(change).every(([key, value]) => this.state[key as keyof CadetSnapshot] === value)) return
    this.state = Object.freeze({ ...this.state, ...change })
    for (const listener of this.listeners) listener()
  }

  private emit(type: CadetEventType, x: number, z: number, value?: number): void {
    this.events.push({ id: ++this.eventId, type, x, z, value })
    if (this.events.length > 80) this.events.shift()
  }

  private announce(message: string, duration = 2.4): void {
    this.messageUntil = this.elapsed + duration
    this.patch({ message })
  }

  private idleMessage(): string {
    const s = this.state
    if (!s.fuel) return 'RE-FUEL SHIP'
    if (s.mission !== null) {
      const step = MISSIONS[s.mission].steps[s.missionStage]
      return `${step.brief.toUpperCase()} ${s.missionProgress}/${step.goal}`
    }
    return s.selectedMission !== null ? `LAUNCH RAMP TO ACCEPT ${MISSIONS[s.selectedMission].name.toUpperCase()}` : 'HIT MISSION TARGETS TO SELECT MISSION'
  }

  private score(points: number, field = true): number {
    if (this.state.tilted) return 0
    const value = Math.round(points * (field ? this.state.multiplier : 1))
    if (field) {
      if (this.boosterUntil[1] > this.elapsed) this.jackpotValue += points
      if (this.boosterUntil[2] > this.elapsed || this.boosterUntil[3] > this.elapsed) this.bonusValue = Math.min(5_000_000, this.bonusValue + points)
    }
    const score = this.state.score + value
    if (score > this.best) {
      this.best = score
      try { globalThis.localStorage?.setItem(BEST_KEY, String(score)) } catch { /* Storage is optional. */ }
    }
    this.patch({ score, best: this.best })
    return value
  }

  private random(): number {
    this.randomState ^= this.randomState << 13
    this.randomState ^= this.randomState >>> 17
    this.randomState ^= this.randomState << 5
    return (this.randomState >>> 0) / 4294967296
  }

  setFlipper(side: 'left' | 'right', pressed: boolean): void {
    const wasPressed = side === 'left' ? this.leftPressed : this.rightPressed
    if (side === 'left') this.leftPressed = pressed
    else this.rightPressed = pressed
    // Flipper presses rotate the lit re-entry lanes, as on the real machine.
    if (pressed && !wasPressed && this.state.status === 'playing' && !this.state.tilted) {
      for (const lit of [this.reentryLit, this.engineLit]) {
      if (side === 'left') lit.push(lit.shift()!)
      else lit.unshift(lit.pop()!)
      }
    }
  }

  startCharge(): void {
    if (!this.state.launchReady || this.state.status === 'paused' || this.state.status === 'gameover') return
    this.charging = true
  }

  cancelCharge(): void {
    this.charging = false
    this.charge = 0
    this.patch({ charge: 0 })
  }

  releaseCharge(): void {
    if (!this.charging) return
    this.charging = false
    if (!this.state.launchReady || this.state.status === 'paused' || this.state.status === 'gameover') {
      this.charge = 0
      this.patch({ charge: 0 })
      return
    }
    const power = this.charge
    this.charge = 0
    this.launch(power)
    this.saveUntil = this.elapsed + 30
    if (this.fuelDrainAt === 0) this.fuelDrainAt = this.elapsed + 10
    this.patch({ status: 'playing', launchReady: false, charge: 0, ballSave: true })
    this.announce(this.replayBall ? 'REPLAY BALL' : 'DEPLOYMENT — SKILL SHOT AVAILABLE', 2.6)
  }

  private launch(power: number): void {
    Object.assign(this.current, { x: SERVE.x, y: BALL_Y, z: SERVE.z, vx: 0, vz: -(3 + power * 15.5) })
    this.stillSince = this.elapsed
    this.currentState.launchTime = this.elapsed
    this.currentState.deploying = true
    this.currentState.deploymentLights = 0
    this.emit('launch', this.current.x, this.current.z, power)
  }

  togglePause(): void {
    if (this.state.status === 'gameover') return
    if (this.state.status === 'paused') {
      this.patch({ status: this.savedStatus })
    } else {
      this.savedStatus = this.state.status
      this.charging = false
      this.charge = 0
      this.leftPressed = this.rightPressed = false
      this.patch({ status: 'paused', charge: 0 })
    }
    this.accumulator = 0
  }

  newGame(): void {
    this.current = this.balls[0]
    this.balls.splice(1)
    this.ballStates = new WeakMap([[this.current, freshBallState()]])
    this.boosterUntil.fill(0)
    this.bonusValue = 10_000
    this.wallUntil = this.bonusElapsed = this.bonusTickAt = 0
    this.elapsed = this.accumulator = 0
    this.saveUntil = this.comboUntil = this.messageUntil = this.slingUntil = 0
    this.lastNudge = -10
    this.nudges = []
    for (const list of [this.bumperFlashes, this.bumperCooldowns, this.targetFlashes, this.targetCooldowns, this.rolloverFlashes,
      this.spinnerAngles, this.spinnerVelocity, this.slingFlashes, this.spinnerHalfTurns, this.saucerFlashes, this.wormholeFlashes, this.flipperUntil, this.dropResetAt]) list.fill(0)
    this.resetTable()
    this.capture = null
    this.captureCooldown = this.wellCooldown = 0
    this.events = []
    this.leftPressed = this.rightPressed = false
    this.leftAngle = this.rightAngle = FLIPPER.rest
    this.centerPostUp = false
    this.randomState = 0x5ca7c0de
    this.serve()
    this.state = Object.freeze(this.freshSnapshot())
    for (const listener of this.listeners) listener()
  }

  nudge(): void {
    if (this.state.status !== 'playing' || this.state.launchReady || this.state.tilted || this.state.bonus) return
    if (this.elapsed - this.lastNudge < 0.45) return
    this.lastNudge = this.elapsed
    this.nudges = this.nudges.filter(time => this.elapsed - time < 5)
    this.nudges.push(this.elapsed)
    if (this.nudges.length >= 3) {
      this.saveUntil = 0
      this.replayAwarded = false
      this.patch({ tilted: true, ballSave: false, replay: false, combo: 0 })
      this.announce('TILT', 999)
      this.emit('tilt', this.current.x, this.current.z)
      return
    }
    for (const ball of this.balls) {
      if (this.ballStates.get(ball)!.capture) continue
      ball.vz -= 3.1
      ball.vx += (ball.x > -0.25 ? -1 : 1) * (1.1 + this.random() * 0.5)
    }
    this.emit('nudge', this.current.x, this.current.z)
    this.announce(this.nudges.length === 2 ? 'DANGER — TILT WARNING' : 'TABLE NUDGED', 1.5)
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0 || this.state.status === 'paused' || this.state.status === 'gameover') return
    this.accumulator += Math.min(delta, 0.1)
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP
      this.step(STEP)
    }
    this.patch({ charge: Math.round(this.charge * 100) / 100 })
  }

  private step(dt: number): void {
    if (this.state.status === 'gameover') return
    this.elapsed += dt
    if (this.state.bonus) {
      this.updateBonus(dt)
      return
    }
    const fade = (list: number[], rate: number) => { for (let i = 0; i < list.length; i++) list[i] = Math.max(0, list[i] - dt * rate) }
    fade(this.bumperFlashes, 3.4)
    fade(this.targetFlashes, 2.5)
    fade(this.rolloverFlashes, 1.4)
    fade(this.saucerFlashes, 1.2)
    fade(this.wormholeFlashes, 1.2)
    fade(this.slingFlashes, 5)
    if (this.charging) this.charge = Math.min(1, this.charge + dt / 1.05)
    if (this.state.combo && this.elapsed > this.comboUntil) this.patch({ combo: 0 })
    if (this.state.ballSave && this.elapsed >= this.saveUntil) this.patch({ ballSave: false })
    if (this.messageUntil > 0 && this.elapsed > this.messageUntil && !this.state.launchReady && !this.state.tilted) {
      this.messageUntil = 0
      this.patch({ message: this.idleMessage() })
    }
    this.updateSpinners(dt)
    for (let bank = 0; bank < 3; bank++) {
      if (this.dropResetAt[bank] && this.elapsed > this.dropResetAt[bank]) {
        this.dropResetAt[bank] = 0
        DROPS.forEach((drop, i) => { if (drop.bank === bank) this.dropsDown[i] = false })
      }
    }

    const prevLeft = this.leftAngle
    const prevRight = this.rightAngle
    this.leftAngle = this.moveFlipper(this.leftAngle, this.leftPressed, dt)
    this.rightAngle = this.moveFlipper(this.rightAngle, this.rightPressed, dt)
    if (this.state.launchReady || this.state.status !== 'playing') return

    this.updateAwards()
    this.centerPostUp = !this.state.tilted && this.elapsed < this.centerPostUntil
    for (const ball of [...this.balls]) {
      if (!this.balls.includes(ball)) continue
      this.current = ball
      this.stepBall(dt, (this.leftAngle - prevLeft) / dt, (this.rightAngle - prevRight) / dt)
    }
    this.collideBalls()
    this.current = this.balls[0]
  }

  private stepBall(dt: number, leftVelocity: number, rightVelocity: number): void {
    const ball = this.current
    if (this.capture) {
      this.updateCapture(dt)
      return
    }

    ball.vz += GRAVITY * dt
    if (ball.y < BALL_Y + 0.1) this.applyGravityWell(dt)
    const drag = Math.exp(-0.055 * dt)
    ball.vx *= drag
    ball.vz *= drag
    const speed = Math.hypot(ball.vx, ball.vz)
    if (speed > MAX_SPEED) {
      ball.vx *= MAX_SPEED / speed
      ball.vz *= MAX_SPEED / speed
    } else if (speed > 0 && speed < 3) {
      const slowed = Math.max(0, speed - 0.35 * dt) / speed
      ball.vx *= slowed
      ball.vz *= slowed
    }
    const prevZ = ball.z
    ball.x += ball.vx * dt
    ball.z += ball.vz * dt

    const state = this.currentState
    if (state.onDeck && !onLaunchDeck(ball.x, ball.z)) {
      state.onDeck = false
      // The platform has one exit: its enclosed descent feeds the bonus lane.
      Object.assign(ball, { x: -2.565, z: 2.25, vx: 0, vz: 2 })
      this.capture = { kind: 'bonusLane', progress: 0 }
      this.reflexUntil = this.elapsed + 8
      return
    }
    if (state.onDeck) {
      const inLanes = ball.z >= -.48 && ball.z <= -.16
      if (inLanes && !this.rolloverInside[15]) {
        if (!state.deckLane) { state.deckLane = true; this.awardRamp() }
        this.hitEngine(clamp(Math.round((ball.x + 3) / .43), 0, 2))
      }
      this.rolloverInside[15] = inLanes
    }
    if (state.onDeck) ball.y = DECK_Y + BALL_Y
    else if (ball.y > BALL_Y) {
      state.verticalSpeed -= 12 * dt
      ball.y = Math.max(BALL_Y, ball.y + state.verticalSpeed * dt)
    } else state.verticalSpeed = 0
    const ground = ball.y < BALL_Y + 0.12

    if (state.deploying) {
      if (ball.x > 2.85) state.deploymentLights = Math.max(state.deploymentLights, clamp(Math.floor((4.85 - ball.z) / .62) + 1, 0, 6))
      if (ball.z < -2.6) state.deploying = false
      else if (ball.vz > 0 && ball.z > 4.65) {
        if (!this.replayBall && state.deploymentLights > 0) {
          const value = this.score(SKILL_AWARDS[state.deploymentLights - 1])
          this.announce(`SKILL SHOT +${value.toLocaleString('en-US')}`)
        }
        state.deploying = false
        Object.assign(ball, { x: 2.55, z: 4.8, vx: -5, vz: -3 })
        this.advanceMission('lane')
      }
    }
    // A substep at top speed moves 0.1 units, under the ball radius. Two passes
    // settle shared vertices without tunnelling.
    for (let pass = 0; pass < 2; pass++) {
      for (const segment of SEGMENTS) this.collideSegment(segment)
      for (const segment of DECK_RAILS) this.collideSegment(segment)
      if (ground) this.collideFlipper('left', this.leftAngle, leftVelocity)
      if (ground) this.collideFlipper('right', this.rightAngle, rightVelocity)
      BUMPERS.forEach((_, i) => this.collideBumper(i))
      if (ground) TARGETS.forEach((_, i) => this.collideTarget(i))
      if (ground) DROPS.forEach((_, i) => this.collideDrop(i))
      if (ground && this.centerPostUp) this.collidePost(CENTER_POST.x, CENTER_POST.z, CENTER_POST.radius, 0.5)
    }

    if (ground) {
      this.checkSpinners(prevZ)
      this.checkRollovers()
      this.checkKickers()
      if (this.elapsed > this.captureCooldown) this.checkCaptures()
    }
    if (this.capture) return
    this.ballSearch()

    if (!Number.isFinite(ball.x + ball.y + ball.z + ball.vx + ball.vz) || ball.x < TABLE.left - 0.5 || ball.x > TABLE.right + 0.5 || ball.z < TABLE.top - 0.5) {
      // A safety net that should never trigger: return the ball to the shooter without penalty.
      if (this.balls.length > 1) { this.redeploy(0.6); return }
      this.serve()
      this.patch({ launchReady: true })
      this.announce('BALL RETURNED — LAUNCH AGAIN', 999)
      return
    }
    if (ball.x > 2.85 && ball.z > 5.3 && ball.vz > 0) {
      if (this.balls.length > 1) { this.redeploy(0.6); return }
      this.serve()
      this.patch({ launchReady: true })
      this.announce('BALL IN CHUTE — LAUNCH AGAIN', 999)
      return
    }
    if (ball.z > DRAIN_Z || (ball.z > OUTLANE_DRAIN_Z && isOutlane(ball.x))) this.drainCurrentBall()
  }

  private moveFlipper(angle: number, pressed: boolean, dt: number): number {
    const raised = pressed && !this.state.tilted
    const target = raised ? FLIPPER.raised : FLIPPER.rest
    const rate = raised ? 18 : 9
    return angle + clamp(target - angle, -rate * dt, rate * dt)
  }

  private applyGravityWell(dt: number): void {
    if (!this.gravityActive || this.state.tilted) return
    const ball = this.current
    const dx = GRAVITY_WELL.x - ball.x, dz = GRAVITY_WELL.z - ball.z
    const dist = Math.hypot(dx, dz)
    if (dist > GRAVITY_WELL.radius || dist < .001) return
    ball.vx += dx / dist * 22 * dt
    ball.vz += dz / dist * 22 * dt
    ball.vx *= Math.exp(-5 * dt)
    ball.vz *= Math.exp(-5 * dt)
  }

  private collideSegment(segment: Segment): void {
    const ball = this.current
    const bottom = segment.elevation ?? 0
    const top = bottom + (segment.height ?? .38)
    if (ball.y + BALL_RADIUS <= bottom || ball.y - BALL_RADIUS >= top) return
    const { a, b, kind } = segment
    const reach = BALL_RADIUS + (segment.radius ?? (kind === 'wall' ? .075 : .065))
    if (ball.x < Math.min(a[0], b[0]) - reach || ball.x > Math.max(a[0], b[0]) + reach ||
        ball.z < Math.min(a[1], b[1]) - reach || ball.z > Math.max(a[1], b[1]) + reach) return
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = clamp(((ball.x - a[0]) * dx + (ball.z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1)
    const px = a[0] + dx * t
    const pz = a[1] + dz * t
    const dist = Math.hypot(ball.x - px, ball.z - pz)
    const radius = BALL_RADIUS + (segment.radius ?? (kind === 'wall' ? 0.075 : 0.065))
    if (dist >= radius) return
    const nx = dist > 0.00001 ? (ball.x - px) / dist : -dz / Math.hypot(dx, dz)
    const nz = dist > 0.00001 ? (ball.z - pz) / dist : dx / Math.hypot(dx, dz)
    // The deployment gate only blocks balls falling back toward the plunger.
    if (kind === 'gate' && nz > 0) return
    ball.x += nx * (radius - dist + 0.0001)
    ball.z += nz * (radius - dist + 0.0001)
    const incoming = ball.vx * nx + ball.vz * nz
    if (incoming >= 0) return
    const sling = kind === 'sling' && this.elapsed > this.slingUntil && !this.state.tilted && incoming < -0.6
    // Glancing contacts slide along walls so orbit shots hug the top arc.
    const glancing = -incoming < 0.35 * Math.hypot(ball.vx, ball.vz)
    const restitution = sling ? 0.9 : glancing ? 0.1 : 0.55
    const impulse = -(1 + restitution) * incoming + (sling ? 4.4 : 0)
    ball.vx += nx * impulse
    ball.vz += nz * impulse
    if (sling) {
      this.slingUntil = this.elapsed + 0.12
      this.slingFlashes[px < -0.25 ? 0 : 1] = 1
      const value = this.score(500)
      this.advanceMission('rebound')
      this.emit('sling', px, pz, value)
    } else if ((kind === 'wall' || kind === 'guide') && -incoming > 1.5 && this.elapsed > this.wallUntil) {
      this.wallUntil = this.elapsed + 0.06
      this.emit('wall', px, pz, -incoming)
    }
  }

  /** Plain post collision. Returns the impact speed, or 0 without a hit. */
  private collidePost(x: number, z: number, postRadius: number, restitution: number): number {
    const ball = this.current
    const dx = ball.x - x
    const dz = ball.z - z
    const dist = Math.hypot(dx, dz)
    const radius = postRadius + BALL_RADIUS
    if (dist >= radius) return 0
    const nx = dist > 0.00001 ? dx / dist : 0
    const nz = dist > 0.00001 ? dz / dist : 1
    ball.x = x + nx * (radius + 0.0001)
    ball.z = z + nz * (radius + 0.0001)
    const incoming = ball.vx * nx + ball.vz * nz
    if (incoming >= 0) return 0
    const impulse = -(1 + restitution) * incoming
    ball.vx += nx * impulse
    ball.vz += nz * impulse
    return -incoming
  }

  private collideBumper(index: number): void {
    const bumper = BUMPERS[index]
    const ball = this.current
    if (Math.abs(ball.y - (BALL_Y + bumper.elevation)) > 0.2) return
    const dx = ball.x - bumper.x
    const dz = ball.z - bumper.z
    const dist = Math.hypot(dx, dz)
    const radius = bumper.radius + BALL_RADIUS
    if (dist >= radius) return
    const nx = dist > 0.00001 ? dx / dist : 0
    const nz = dist > 0.00001 ? dz / dist : 1
    ball.x = bumper.x + nx * (radius + 0.0001)
    ball.z = bumper.z + nz * (radius + 0.0001)
    const incoming = ball.vx * nx + ball.vz * nz
    if (incoming >= 0) return
    const energized = !this.state.tilted && this.elapsed >= this.bumperCooldowns[index]
    const impulse = -incoming * 1.8 + (energized ? 5.2 : 0)
    ball.vx += nx * impulse
    ball.vz += nz * impulse
    if (!energized) return
    this.bumperCooldowns[index] = this.elapsed + 0.1
    this.bumperFlashes[index] = 1
    const combo = this.elapsed < this.comboUntil ? Math.min(8, this.state.combo + 1) : 1
    this.comboUntil = this.elapsed + 2.25
    this.patch({ combo, hits: this.state.hits + 1 })
    const attack = bumper.kind === 'attack'
    const level = attack ? this.attackLevel : this.engineLevel
    const value = this.score(attack && index !== 0 ? 500 + level * 500 : 1500 + level * 1000)
    this.emit('bumper', bumper.x, bumper.z, value)
    this.announce(`${index === 0 ? 'SATELLITE' : attack ? 'ATTACK' : 'ENGINE'} BUMPER +${value}`, 1.6)
    if (attack) this.advanceMission(index === 0 ? 'satellite' : 'bumper')
  }

  private collideTarget(index: number): void {
    const target = TARGETS[index]
    const impact = this.collidePost(target.x, target.z, target.radius, .5)
    if (impact < .8 || this.state.tilted || this.elapsed < this.targetCooldowns[index]) return
    this.targetCooldowns[index] = this.elapsed + .3
    this.targetFlashes[index] = 1
    this.emit('target', target.x, target.z)
    this.hitTarget(index)
  }

  private hitTarget(index: number): void {
    if (this.state.tilted) return
    const target = TARGETS[index]
    this.score(target.group === 'mission' ? 1000 : 750)
    this.advanceMission('spot')
    if (target.group === 'mission') {
      if (this.state.mission !== null) return
      this.targetLit[index] = true
      const all = this.targetLit.slice(3, 6).every(Boolean)
      const selectedMission = missionsForRank(this.state.rank)[all ? 3 : index - 3]
      if (all) this.targetLit.fill(false, 3, 6)
      this.bonusValue = Math.max(25_000, this.bonusValue)
      this.patch({ selectedMission, missionReady: true })
      this.announce(this.idleMessage())
      return
    }
    if (target.group === 'wormhole') {
      this.wormholeOpen = true
      this.wormholeExit = (this.wormholeExit + 1) % 3
      this.targetLit[index] = true
      this.announce('WORMHOLE OPENED')
      return
    }
    this.targetLit[index] = true
    const start = target.group === 'fuel' ? 0 : target.group === 'radiation' ? 7 : 10
    if (this.targetLit.slice(start, start + 3).every(Boolean)) {
      this.targetLit.fill(false, start, start + 3)
      if (target.group === 'fuel') this.refuel()
      else {
        this.kickersArmed[target.group === 'radiation' ? 0 : 1] = true
        this.advanceMission(target.group)
        this.announce(`${target.group === 'radiation' ? 'LEFT' : 'RIGHT'} OUT-LANE KICKER ARMED`)
      }
    }
  }

  private collideDrop(index: number): void {
    if (this.dropsDown[index]) return
    const drop = DROPS[index]
    if (this.collidePost(drop.x, drop.z, drop.radius, .4) < 1 || this.state.tilted) return
    this.hitDrop(index)
  }

  private hitDrop(index: number): void {
    if (this.state.tilted || this.dropsDown[index]) return
    const drop = DROPS[index], bank = drop.bank
    this.dropsDown[index] = true
    this.emit('drop', drop.x, drop.z)
    const complete = DROPS.every((d, i) => d.bank !== bank || this.dropsDown[i])
    if (!complete) this.score(bank === 1 ? 1500 : 500)
    else {
      this.dropResetAt[bank] = this.elapsed + .7
      if (bank === 0) {
        this.patch({ multiplier: MULTIPLIERS[Math.min(4, MULTIPLIERS.indexOf(this.state.multiplier) + 1)] })
        this.multiplierUntil = this.elapsed + 60
        this.score(1500)
        this.announce(`FIELD MULTIPLIER ${this.state.multiplier}×`)
      } else if (bank === 1) {
        this.medalLevel = Math.min(3, this.medalLevel + 1)
        this.medalUntil = this.elapsed + 60
        if (this.medalLevel === 3) this.awardExtraBall()
        else this.score(this.medalLevel === 1 ? 10_000 : 50_000)
        this.announce(`LEVEL ${this.medalLevel} COMMENDATION${this.medalLevel === 3 ? ' — EXTRA BALL' : ''}`)
      } else {
        this.score(5000)
        const mode = this.boosterUntil.findIndex(until => until <= this.elapsed)
        const next = mode < 0 ? 3 : mode
        this.boosterUntil[next] = this.elapsed + 60
        if (next === 0 || this.state.mission === 5) this.flagsUntil = this.elapsed + 60
        this.announce(['FLAGS UPGRADED', 'JACKPOT ACTIVATED', 'BONUS ACTIVATED', 'BONUS HOLD'][next])
      }
    }
    this.advanceMission('drop')
  }

  private collideFlipper(side: 'left' | 'right', angle: number, angularVelocity: number): void {
    const ball = this.current
    const sign = side === 'left' ? 1 : -1
    const pivotX = side === 'left' ? FLIPPER.leftX : FLIPPER.rightX
    const ux = Math.cos(angle) * sign
    const uz = Math.sin(angle)
    const along = clamp((ball.x - pivotX) * ux + (ball.z - FLIPPER.pivotZ) * uz, 0, FLIPPER.length)
    const px = pivotX + ux * along
    const pz = FLIPPER.pivotZ + uz * along
    const dist = Math.hypot(ball.x - px, ball.z - pz)
    const taper = FLIPPER.radius + (FLIPPER.tipRadius - FLIPPER.radius) * along / FLIPPER.length
    const radius = BALL_RADIUS + taper
    if (dist >= radius) return
    const nx = dist > 0.00001 ? (ball.x - px) / dist : uz * sign
    const nz = dist > 0.00001 ? (ball.z - pz) / dist : -ux * sign
    ball.x += nx * (radius - dist + 0.0001)
    ball.z += nz * (radius - dist + 0.0001)
    const surfaceVX = -Math.sin(angle) * sign * angularVelocity * along
    const surfaceVZ = Math.cos(angle) * angularVelocity * along
    const incoming = (ball.vx - surfaceVX) * nx + (ball.vz - surfaceVZ) * nz
    if (incoming >= 0) return
    const restitution = angularVelocity < -0.5 ? 0.72 : Math.abs(angularVelocity) < 0.5 ? 0.3 : 0.48
    const impulse = -(1 + restitution) * incoming
    ball.vx += impulse * nx
    ball.vz += impulse * nz
    const index = side === 'left' ? 0 : 1
    if (this.elapsed > this.flipperUntil[index] && Math.abs(incoming) > 0.65) {
      this.flipperUntil[index] = this.elapsed + 0.075
      this.emit('flipper', px, pz, Math.abs(incoming))
    }
  }

  private updateSpinners(dt: number): void {
    SPINNERS.forEach((spinner, i) => {
      if (this.spinnerVelocity[i] < 0.05) return
      this.spinnerAngles[i] += this.spinnerVelocity[i] * dt
      this.spinnerVelocity[i] *= Math.exp(-1.4 * dt)
      const halfTurns = Math.floor(this.spinnerAngles[i] / Math.PI)
      if (halfTurns > this.spinnerHalfTurns[i]) {
        this.spinnerHalfTurns[i] = halfTurns
        if (!this.state.tilted && this.state.status === 'playing') {
          const value = this.score(this.flagsUntil > this.elapsed ? 2500 : 500)
          if (this.wormholeOpen) this.wormholeExit = (this.wormholeExit + 1) % 3
          this.advanceMission('flags')
          this.emit('spinner', (spinner.x0 + spinner.x1) / 2, spinner.z, value)
        }
      }
    })
  }

  private checkSpinners(prevZ: number): void {
    const ball = this.current
    SPINNERS.forEach((spinner, i) => {
      if (ball.x < spinner.x0 || ball.x > spinner.x1) return
      if ((prevZ - spinner.z) * (ball.z - spinner.z) > 0) return
      this.spinnerVelocity[i] = Math.min(60, this.spinnerVelocity[i] + Math.abs(ball.vz) * 2.4)
    })
  }

  private checkRollovers(): void {
    const ball = this.current
    ROLLOVERS.forEach((rollover, i) => {
      if (rollover.kind === 'engine') return
      const inside = Math.hypot(ball.x - rollover.x, ball.z - rollover.z) < rollover.radius
      const entered = inside && !this.rolloverInside[i]
      this.rolloverInside[i] = inside
      if (!entered || this.state.tilted) return
      this.rolloverFlashes[i] = 1
      this.emit('rollover', rollover.x, rollover.z)
      this.hitRollover(i)
    })
  }

  private hitRollover(index: number): void {
    if (this.state.tilted) return
    const kind = ROLLOVERS[index].kind
    if (kind === 'reentry') { this.hitReentry(index); return }
    if (kind === 'engine') { this.hitEngine(index - 15); return }
    if (kind === 'fuel') {
      const light = index - 9
      this.score(light === 5 && !this.fuelLit[light] ? 1500 : 500)
      if (light === 5) { this.refuel(); this.advanceMission('fuel') }
      else if (!this.fuelLit[light]) {
        this.fuelLit[light] = true
        this.patch({ fuel: this.fuelLit.filter(Boolean).length })
        this.fuelDrainAt = this.elapsed + 20 - 2 * this.fuelLit.lastIndexOf(true)
      }
      return
    }
    if (kind === 'spaceWarp') {
      this.returnLit.fill(true)
      this.advanceMission('spaceWarp')
      this.announce('RETURN LANES LIT')
      return
    }
    if (kind === 'bonus') {
      this.score(10_000)
      this.refuel()
      if (this.bonusLit) { this.bonusLit = false; this.score(this.bonusValue, false); this.announce('BONUS AWARDED') }
    } else if (kind === 'return') {
      const side = index === 6 ? 0 : 1
      this.score(this.returnLit[side] ? 25_000 : 5000)
      this.returnLit[side] = false
    } else if (kind === 'out') {
      this.score(20_000)
      if (this.elapsed < this.extraBallUntil) { this.extraBallUntil = 0; this.awardExtraBall() }
    }
    this.advanceMission(kind === 'out' ? 'out' : 'lane')
  }

  private hitReentry(index: number): void {
    this.score(2000)
    this.reentryLit[index] = !this.reentryLit[index]
    if (this.reentryLit.every(Boolean)) {
      this.reentryLit.fill(false)
      this.attackLevel = Math.min(3, this.attackLevel + 1)
      this.attackUntil = this.elapsed + 60
      this.announce('WEAPONS UPGRADED')
    }
    this.advanceMission('reentry')
  }

  private hitEngine(index: number): void {
    this.score(500)
    this.engineLit[index] = !this.engineLit[index]
    if (this.engineLit.every(Boolean)) {
      this.engineLit.fill(false)
      this.engineLevel = Math.min(3, this.engineLevel + 1)
      this.engineUntil = this.elapsed + 60
      this.announce('ENGINES UPGRADED')
    }
    this.advanceMission('lane')
  }

  private checkKickers(): void {
    const ball = this.current
    KICKERS.forEach((kicker, i) => {
      const inside = Math.hypot(ball.x - kicker.x, ball.z - kicker.z) < kicker.radius
      const entered = inside && !this.kickerInside[i]
      this.kickerInside[i] = inside
      if (!entered || !this.kickersArmed[i] || this.state.tilted || ball.vz < 0) return
      this.kickersArmed[i] = false
      ball.x = kicker.x
      ball.vx = 0
      ball.vz = -14.5
      this.emit('kicker', kicker.x, kicker.z)
      this.announce('OUT-LANE KICKBACK', 1.6)
    })
  }

  private checkCaptures(): void {
    if (this.state.tilted) return
    const ball = this.current
    const speed = Math.hypot(ball.vx, ball.vz)
    const captureBusy = this.balls.some(other => other !== ball && this.ballStates.get(other)!.capture !== null)
    if (!captureBusy && ball.x > RAMP_ENTRY.x0 && ball.x < RAMP_ENTRY.x1 && ball.z > RAMP_ENTRY.z0 && ball.z < RAMP_ENTRY.z1 && ball.vz < -2.5) {
      this.capture = { kind: 'ramp', distance: 0, speed: clamp(speed * 0.75, 7, 11) }
      this.emit('ramp', ball.x, ball.z)
      return
    }
    for (let i = 0; i < SAUCERS.length; i++) {
      const saucer = SAUCERS[i]
      if (Math.hypot(ball.x - saucer.x, ball.z - saucer.z) < saucer.radius && speed < (saucer.kind === 'hyperspace' ? 20 : 14) && !captureBusy) {
        this.capture = { kind: 'saucer', index: i, until: this.elapsed + 1.1 }
        this.saucerFlashes[i] = 1
        this.emit('kickout', saucer.x, saucer.z)
        this.awardSaucer(i)
        return
      }
    }
    for (let i = 0; i < WORMHOLES.length; i++) {
      const hole = WORMHOLES[i]
      if (Math.hypot(ball.x - hole.x, ball.z - hole.z) < hole.radius && speed < 12 && !captureBusy) {
        this.enterWormhole(i)
        return
      }
    }
    const well = Math.hypot(ball.x - GRAVITY_WELL.x, ball.z - GRAVITY_WELL.z) < .18
    if (this.gravityActive && well && speed < 2 && this.elapsed > this.wellCooldown) {
      this.gravityActive = false
      this.wellCooldown = this.elapsed + 1.2
      this.capture = { kind: 'well', until: this.elapsed + .6 }
      this.score(50_000)
      this.emit('hyperspace', GRAVITY_WELL.x, GRAVITY_WELL.z)
      this.announce('GRAVITY NORMALIZED +50,000')
    }
    this.wellInside = well
  }

  private enterWormhole(index: number): void {
    const hole = WORMHOLES[index]
    const secret = this.state.mission === 7
    const to = this.wormholeOpen ? this.wormholeExit : index
    const value = this.score(this.wormholeOpen ? to === index ? 5000 : 7500 : 2000)
    if (this.wormholeOpen && to === index && !secret) {
      this.replayAwarded = true
      this.patch({ replay: true })
    }
    this.wormholeOpen = false
    this.targetLit[6] = false
    this.capture = { kind: 'wormhole', from: index, to, phase: 'sink', until: this.elapsed + .45 }
    this.wormholeFlashes[index] = 1
    this.emit('wormhole', hole.x, hole.z)
    this.announce(`${this.replayAwarded ? 'REPLAY AWARDED' : 'WORMHOLE'} +${value}`)
    this.advanceMission((['green', 'red', 'yellow'] as const)[index])
  }

  private awardSaucer(index: number): void {
    const kind = SAUCERS[index].kind
    if (kind === 'hyperspace') {
      const level = this.state.hyperspace
      const value = this.score(HYPERSPACE_AWARDS[level])
      if (this.elapsed < this.hyperReflexUntil) this.score(20_000)
      this.hyperspaceUntil = this.elapsed + 60
      this.patch({ hyperspace: (level + 1) % 5 })
      if (level === 1) { this.score(this.jackpotValue, false); this.jackpotValue = 20_000 }
      if (level === 2) this.centerPostUntil = this.elapsed + 60
      if (level === 3) this.extraBallUntil = this.elapsed + 60
      if (level === 4) this.gravityActive = true
      this.emit('hyperspace', SAUCERS[index].x, SAUCERS[index].z)
      this.announce(`${['HYPERSPACE BONUS', 'JACKPOT AWARDED', 'CENTER POST', 'EXTRA BALL AVAILABLE', 'GRAVITY WELL ACTIVATED'][level]} +${value}`)
      this.advanceMission('hyperspace')
    } else if (kind === 'blackHole') {
      this.announce(`BLACK HOLE +${this.score(20_000)}`)
      this.advanceMission('blackHole')
    } else this.announce('SECONDARY OUT KICKER — RE-DEPLOYING')
  }

  private updateCapture(dt: number): void {
    const capture = this.capture!
    const ball = this.current
    if (capture.kind === 'bonusLane') {
      capture.progress = Math.min(1, capture.progress + dt * 2.5)
      Object.assign(ball, { x: -2.565, z: 2.25 + capture.progress * .4, y: BALL_Y + DECK_Y * (1 - capture.progress), vx: 0, vz: 2 })
      if (capture.progress < 1) return
      this.release(.3)
      this.hitRollover(5)
      this.rolloverInside[5] = true
      return
    }
    if (capture.kind === 'ramp') {
      const before = sampleRamp(capture.distance)
      capture.distance += capture.speed * dt
      const [x, y, z] = sampleRamp(capture.distance)
      ball.vx = (x - before[0]) / dt
      ball.vz = (z - before[2]) / dt
      Object.assign(ball, { x, y: BALL_Y + y, z })
      if (capture.distance < RAMP.total) return
      const [ax, , az] = RAMP_PATH[RAMP_PATH.length - 2]
      const [bx, , bz] = RAMP_PATH[RAMP_PATH.length - 1]
      const length = Math.hypot(bx - ax, bz - az)
      Object.assign(ball, { x: bx, y: BALL_Y + DECK_Y, z: bz, vx: (bx - ax) / length * 0.6, vz: 2.0 })
      this.release(0.4)
      this.currentState.onDeck = true
      this.currentState.deckLane = false
      this.currentState.verticalSpeed = 0
      return
    }
    if (capture.kind === 'saucer') {
      const saucer = SAUCERS[capture.index]
      ball.x += (saucer.x - ball.x) * Math.min(1, dt * 14)
      ball.z += (saucer.z - ball.z) * Math.min(1, dt * 14)
      ball.vx = ball.vz = 0
      ball.y = Math.max(BALL_Y - 0.13, ball.y - dt * 0.8)
      if (this.elapsed < capture.until) return
      let vx: number, vz: number
      if (saucer.kind === 'escape') {
        Object.assign(ball, { x: SERVE.x, y: BALL_Y, z: .8, vx: 0, vz: -15 })
        this.release(.6)
        return
      } else {
        vx = saucer.eject[0] + (this.random() - .5) * .6
        vz = saucer.eject[1]
      }
      if (saucer.kind === 'hyperspace') this.hyperReflexUntil = this.elapsed + 8
      Object.assign(ball, { x: saucer.x, y: BALL_Y, z: saucer.z, vx, vz })
      this.emit('kickout', saucer.x, saucer.z)
      this.release(0.6)
      return
    }
    if (capture.kind === 'wormhole') {
      const hole = WORMHOLES[capture.phase === 'sink' ? capture.from : capture.to]
      ball.vx = ball.vz = 0
      if (capture.phase === 'sink') {
        ball.x += (hole.x - ball.x) * Math.min(1, dt * 12)
        ball.z += (hole.z - ball.z) * Math.min(1, dt * 12)
        ball.y = Math.max(-0.2, ball.y - dt * 1.2)
        if (this.elapsed < capture.until) return
        Object.assign(ball, { x: WORMHOLES[capture.to].x, z: WORMHOLES[capture.to].z, y: -0.2 })
        this.capture = { ...capture, phase: 'rise', until: this.elapsed + 0.35 }
        this.wormholeFlashes[capture.to] = 1
        return
      }
      ball.y = Math.min(BALL_Y, ball.y + dt * 1.4)
      if (this.elapsed < capture.until) return
      Object.assign(ball, { y: BALL_Y, vx: (this.random() - 0.5) * 3, vz: 2.5 })
      this.emit('wormhole', hole.x, hole.z)
      this.release(0.7)
      return
    }
    if (capture.kind === 'well') {
      Object.assign(ball, {x: GRAVITY_WELL.x, z: GRAVITY_WELL.z, vx: 0, vz: 0})
      if (this.elapsed < capture.until) return
      const angle = this.random() * Math.PI * 2
      ball.vx = Math.cos(angle) * 7; ball.vz = Math.sin(angle) * 7
      this.release(.7)
      return
    }
    // Secondary kickout reinforcements launch automatically from the plunger.
    ball.vx = ball.vz = 0
    if (this.elapsed < capture.until) return
    this.capture = null
    this.launch(capture.power ?? 0.55)
    this.captureCooldown = this.elapsed + 0.3
  }

  private release(cooldown: number): void {
    this.capture = null
    this.captureCooldown = this.elapsed + cooldown
    this.stillSince = this.elapsed
    this.rolloverInside.fill(false)
  }

  private awardRamp(): void {
    if (this.state.tilted) return
    const value = this.score(this.elapsed < this.reflexUntil ? 25_000 : 5000)
    this.emit('bonus', this.current.x, this.current.z)
    if (this.state.selectedMission !== null && this.state.fuel > 0) {
      this.acceptMission()
      return
    }
    this.announce(`LAUNCH RAMP +${value}`)
    this.advanceMission('ramp')
  }

  private acceptMission(): void {
    const mission = this.state.selectedMission
    if (mission === null || !this.state.fuel || this.state.mission !== null) return
    if (mission === 3 || mission === 4) { this.dropsDown.fill(false); this.dropResetAt.fill(0) }
    if (mission === 4) { this.targetLit.fill(false); this.wormholeOpen = false }
    if (mission === 5) this.flagsUntil = 0
    if (mission === 6) { this.attackLevel = 0; this.attackUntil = 0 }
    if (mission === 8) this.targetLit.fill(false, 10, 13)
    if (mission === 9) this.targetLit.fill(false, 7, 10)
    if (mission === 10) { this.engineLevel = 0; this.engineUntil = 0 }
    this.targetLit.fill(false, 3, 6)
    this.patch({ mission, selectedMission: null, missionReady: false, missionStage: 0, missionProgress: 0 })
    this.score(MISSIONS[mission].accept, false)
    this.emit('mission', this.current.x, this.current.z)
    this.announce(`MISSION ACCEPTED: ${MISSIONS[mission].name.toUpperCase()}`)
  }

  private advanceMission(kind: MissionKind): void {
    const s = this.state
    if (s.mission === null || this.state.tilted) return
    const mission = MISSIONS[s.mission], step = mission.steps[s.missionStage]
    const match = step.kind === kind || step.kind === 'bumper' && kind === 'satellite'
      || step.kind === 'target' && (kind === 'spot' || kind === 'drop')
      || step.kind === 'lane' && (kind === 'out' || kind === 'reentry')
      || step.kind === 'wormhole' && ['green', 'red', 'yellow'].includes(kind)
      || step.kind === 'timeWarp' && (kind === 'ramp' || kind === 'hyperspace')
    if (!match || step.requires === 'attack' && !this.attackLevel || step.requires === 'engine' && !this.engineLevel || step.requires === 'flags' && this.flagsUntil <= this.elapsed) return
    const progress = s.missionProgress + 1
    if (progress < step.goal) { this.patch({ missionProgress: progress }); return }
    if (s.missionStage < mission.steps.length - 1) {
      this.patch({ missionStage: s.missionStage + 1, missionProgress: 0 })
      this.announce(this.idleMessage())
      return
    }
    let rank = s.rank, rankProgress = s.rankProgress
    if (s.mission === 15 && kind === 'hyperspace') rank = Math.max(0, rank - 1)
    else {
      rankProgress += mission.progress
      if (s.mission === 15) rank = Math.min(8, rank + 1)
      if (rankProgress >= 18) { rank = Math.min(8, rank + 1); rankProgress = 0 }
    }
    const value = this.score(mission.award, false)
    this.bonusLit = true
    this.patch({ mission: null, missionStage: 0, missionProgress: 0, rank, rankProgress })
    this.emit('rank', this.current.x, this.current.z, value)
    if (s.mission === 16) {
      this.medalLevel = 3; this.medalUntil = this.elapsed + 60; this.awardExtraBall()
      this.boosterUntil.fill(this.elapsed + 60); this.flagsUntil = this.elapsed + 60
      this.patch({ multiplier: 10, hyperspace: 4 }); this.multiplierUntil = this.hyperspaceUntil = this.elapsed + 60
      this.score(10_000 + 50_000 + 10_000 + 20_000 + 20_000 + 50_000)
      this.score(this.jackpotValue, false); this.jackpotValue = 20_000
      this.centerPostUntil = this.extraBallUntil = this.elapsed + 60
    }
    this.announce(rank !== s.rank ? `${rank > s.rank ? 'PROMOTION' : 'DEMOTION'} TO ${RANKS[rank].toUpperCase()}` : `MISSION COMPLETED +${value.toLocaleString('en-US')}`, 3.4)
  }

  private refuel(): void {
    this.fuelLit.fill(true)
    this.patch({ fuel: 6 })
    this.fuelDrainAt = this.elapsed + 10
    this.announce('SHIP RE-FUELED')
  }

  private awardExtraBall(): void {
    this.patch({ extraBalls: this.state.extraBalls + 1 })
    this.announce('EXTRA BALL')
  }

  private updateAwards(): void {
    if (this.fuelDrainAt && this.elapsed >= this.fuelDrainAt && this.state.fuel) {
      this.fuelLit[this.fuelLit.lastIndexOf(true)] = false
      const fuel = this.fuelLit.filter(Boolean).length
      this.patch({ fuel })
      this.fuelDrainAt = this.elapsed + 20 - 2 * this.fuelLit.lastIndexOf(true)
      if (fuel === 1) this.announce('WARNING — LOW FUEL')
      if (!fuel) {
        const active = this.state.mission !== null
        if (this.state.mission === 7) { this.wormholeOpen = false; this.targetLit[6] = false }
        this.patch({ mission: null, missionProgress: 0, missionStage: 0 })
        this.announce(active ? 'MISSION ABORTED — RE-FUEL SHIP' : 'RE-FUEL SHIP')
      }
    }
    if (this.attackLevel && this.elapsed >= this.attackUntil) { this.attackLevel--; this.attackUntil = this.elapsed + 60 }
    if (this.engineLevel && this.elapsed >= this.engineUntil) { this.engineLevel--; this.engineUntil = this.elapsed + 60 }
    if (this.medalLevel && this.elapsed >= this.medalUntil) { this.medalLevel--; this.medalUntil = this.elapsed + 60 }
    if (this.state.multiplier > 1 && this.elapsed >= this.multiplierUntil) { this.patch({ multiplier: MULTIPLIERS[MULTIPLIERS.indexOf(this.state.multiplier) - 1] }); this.multiplierUntil = this.elapsed + 60 }
    if (this.state.hyperspace && this.elapsed >= this.hyperspaceUntil) { this.patch({ hyperspace: this.state.hyperspace - 1 }); this.hyperspaceUntil = this.elapsed + 60 }
  }

  private resetTable(): void {
    const heldBonus = this.boosterUntil[3] > this.elapsed
    if (!heldBonus) this.bonusValue = 10_000
    this.jackpotValue = 20_000
    for (const lights of [this.targetLit, this.dropsDown, this.reentryLit, this.engineLit, this.returnLit, this.kickersArmed]) lights.fill(false)
    this.fuelLit.fill(true)
    this.dropResetAt.fill(0); this.boosterUntil.fill(0)
    this.spinnerVelocity.fill(0)
    this.attackLevel = this.engineLevel = this.medalLevel = 0
    this.reflexUntil = this.hyperReflexUntil = this.extraBallUntil = this.centerPostUntil = this.hyperspaceUntil = this.attackUntil = this.engineUntil = this.multiplierUntil = this.medalUntil = this.flagsUntil = this.fuelDrainAt = 0
    this.wormholeOpen = this.gravityActive = this.replayAwarded = this.replayBall = this.bonusLit = false
    this.wormholeExit = 0
    this.patch({ mission: null, selectedMission: null, missionReady: false, missionProgress: 0, missionStage: 0, fuel: 6, multiplier: 1, hyperspace: 0, replay: false, ballSave: false })
  }

  private ballSearch(): void {
    const ball = this.current
    if (Math.hypot(ball.vx, ball.vz) > 0.35 || ball.z > 4.2) {
      this.stillSince = this.elapsed
      return
    }
    if (this.elapsed - this.stillSince < 2.5) return
    // A stalled ball is freed the way real machines do: a gentle ball-search kick.
    this.stillSince = this.elapsed
    ball.vx += (this.random() - 0.5) * 4
    ball.vz -= 2.5
    this.announce('BALL SEARCH', 1)
  }

  private serve(): void {
    Object.assign(this.current, { x: SERVE.x, y: BALL_Y, z: SERVE.z, vx: 0, vz: 0 })
    this.capture = null
    this.currentState.onDeck = false
    this.currentState.verticalSpeed = 0
    this.charge = 0
    this.charging = false
    this.saveUntil = 0
    this.nudges = []
    this.lastNudge = -10
    this.centerPostUp = false
    this.wellInside = false
    this.rolloverInside.fill(false)
    this.kickerInside.fill(false)
  }

  private redeploy(power: number): void {
    Object.assign(this.current, { x: SERVE.x, y: BALL_Y, z: SERVE.z, vx: 0, vz: 0 })
    this.ballStates.set(this.current, freshBallState())
    this.capture = { kind: 'deploy', until: this.elapsed + 0.6, power }
  }

  private collideBalls(): void {
    if (this.balls.length < 2) return
    const [a, b] = this.balls
    if (Math.abs(a.y - b.y) >= BALL_RADIUS * 2) return
    if (this.ballStates.get(a)!.capture || this.ballStates.get(b)!.capture) return
    const dx = b.x - a.x
    const dz = b.z - a.z
    const distance = Math.hypot(dx, dz)
    if (distance >= BALL_RADIUS * 2) return
    const nx = distance > 0.00001 ? dx / distance : 1
    const nz = distance > 0.00001 ? dz / distance : 0
    const correction = (BALL_RADIUS * 2 - distance + 0.0001) / 2
    a.x -= nx * correction
    a.z -= nz * correction
    b.x += nx * correction
    b.z += nz * correction
    const incoming = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz
    if (incoming >= 0) return
    const impulse = -1.9 * incoming / 2
    a.vx -= nx * impulse
    a.vz -= nz * impulse
    b.vx += nx * impulse
    b.vz += nz * impulse
  }

  private drainCurrentBall(): void {
    if (this.balls.length === 1) { this.drain(); return }
    this.emit('drainBall', this.current.x, this.current.z)
    if (this.elapsed < this.saveUntil && !this.state.tilted) {
      this.redeploy(0.7)
      this.announce('MULTIBALL SAVE — RE-DEPLOYING', 2)
      return
    }
    this.balls.splice(this.balls.indexOf(this.current), 1)
    this.ballStates.delete(this.current)
    this.saveUntil = 0
    this.patch({ multiball: false, ballSave: false })
    this.announce('SINGLE BALL — KEEP FLYING', 2)
  }

  private drain(): void {
    this.emit('drain', this.current.x, this.current.z)
    const automatic = this.elapsed < this.saveUntil && !this.state.tilted
    const saved = automatic || this.replayAwarded && !this.state.tilted
    this.patch({ combo: 0, ballSave: false })
    if (saved) {
      if (!automatic) this.replayAwarded = false
      this.serve()
      this.centerPostUp = this.elapsed < this.centerPostUntil
      this.replayBall = true
      this.patch({ launchReady: true, replay: this.replayAwarded })
      this.announce(automatic ? 'RE-DEPLOY — USE PLUNGER' : 'REPLAY BALL — USE PLUNGER', 999)
      return
    }
    this.saveUntil = 0
    this.current.vx = this.current.vz = 0
    const total = this.state.tilted ? 0 : this.bonusValue
    if (!total) { this.finishBall(); return }
    this.bonusElapsed = this.bonusTickAt = 0
    this.patch({ bonus: { count: 0, total, multiplier: 1 }, launchReady: false })
    this.announce('CRASH BONUS', 999)
  }

  private updateBonus(dt: number): void {
    const bonus = this.state.bonus!
    this.bonusElapsed += dt
    if (this.bonusElapsed >= 2.2) { this.finishBonus(); return }
    if (this.bonusElapsed < this.bonusTickAt) return
    this.bonusTickAt = this.bonusElapsed + 0.08
    const count = Math.floor(bonus.total * this.bonusElapsed / 2.2)
    this.patch({ bonus: { ...bonus, count } })
    this.emit('bonusTick', this.current.x, this.current.z, count)
  }

  skipBonus(): void {
    if (this.state.bonus && this.state.status === 'playing') this.finishBonus()
  }

  private finishBonus(): void {
    const bonus = this.state.bonus
    if (!bonus) return
    const score = this.state.score + bonus.total
    if (score > this.best) {
      this.best = score
      try { globalThis.localStorage?.setItem(BEST_KEY, String(score)) } catch { /* Storage is optional. */ }
    }
    this.emit('bonusTick', this.current.x, this.current.z, bonus.total)
    this.patch({ score, best: this.best, bonus: null })
    this.finishBall(bonus.total)
  }

  private finishBall(bonus = 0): void {
    this.resetTable()
    const bonusText = bonus ? ` — BONUS ${bonus.toLocaleString('en-US')}` : ''
    if (this.state.extraBalls > 0) {
      this.serve()
      this.patch({ extraBalls: this.state.extraBalls - 1, launchReady: true, tilted: false })
      this.announce(`SHOOT AGAIN${bonusText}`, 999)
    } else if (this.state.ballNumber < 3) {
      this.serve()
      this.patch({ ballNumber: this.state.ballNumber + 1, launchReady: true, tilted: false })
      this.announce(`NEXT BALL${bonusText}`, 999)
    } else {
      this.current.vx = this.current.vz = 0
      this.patch({ status: 'gameover', launchReady: false, message: `FINAL RANK: ${RANKS[this.state.rank].toUpperCase()}` })
    }
  }
}
