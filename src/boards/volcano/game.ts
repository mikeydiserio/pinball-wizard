import { EXPEDITIONS, expeditionsForRank, type ExpeditionKind } from './missions'
export { EXPEDITIONS } from './missions'
import type { TableGame, TableSnapshot } from '../../game/table'
import {
  BALL_RADIUS, BALL_Y, BUMPERS, CENTER_POST, DRAIN_Z, DROPS, FLIPPER, MAGMA_CHAMBER, KICKERS, OUTLANE_DRAIN_Z,
  DECK_Y, DECK_RAILS, HABITRAIL_PATH, onCraterRim, RAMP_ENTRY, RAMP_PATH, RIM_LANES, ROLLOVERS, SAUCERS, SEGMENTS, SERVE, SPINNERS, TABLE, TARGETS, TUBES,
  isOutlane, type LightKey, type Segment, type Vec3,
} from './layout'

export type VolcanoEventType =
  | 'bumper' | 'sling' | 'flipper' | 'launch' | 'drain' | 'nudge' | 'target' | 'tilt'
  | 'ramp' | 'tube' | 'kickout' | 'rollover' | 'drop' | 'spinner' | 'rank' | 'expedition'
  | 'kicker' | 'eruption' | 'chamber' | 'bonus' | 'wall' | 'bonusTick'
export interface VolcanoBall { x: number; y: number; z: number; vx: number; vz: number }
export interface VolcanoEvent { id: number; type: VolcanoEventType; x: number; z: number; value?: number }

export const RANKS = ['Ash Scout', 'Lava Runner', 'Crater Ranger', 'Vent Warden', 'Magma Diver', 'Caldera Captain', 'Pyroclast Commander', 'Fire Marshal', 'Volcano Lord'] as const

export type VolcanoSnapshot = TableSnapshot & Readonly<{
  rank: number
  rankProgress: number
  selectedExpedition: number | null
  expeditionStage: number
  replay: boolean
  expedition: number | null
  expeditionProgress: number
  expeditionReady: boolean
  pressure: number
  eruption: number
  extraBalls: number
  bonus: { count: number; total: number } | null
}>

type Capture =
  | { kind: 'ramp'; distance: number; speed: number }
  | { kind: 'saucer'; index: number; until: number }
  | { kind: 'tube'; from: number; to: number; phase: 'sink' | 'rise'; until: number }
  | { kind: 'chamber'; until: number }
  | { kind: 'habitrail'; distance: number }

const STEP = 1 / 240
const GRAVITY = 4.7
const MAX_SPEED = 20
const BEST_KEY = 'eruption-pinball-best'
/** Seconds the lava shield (automatic replay) stays up after a launch. */
export const LAVA_SHIELD = 25
/** Heat upgrades (bumpers, fissure multiplier) cool one level per window. */
const HEAT_WINDOW = 45
const AWARD_WINDOW = 60
const ERUPTION_AWARDS = [15_000, 25_000, 40_000, 75_000, 200_000]
const ERUPTION_NAMES = ['ASH CLOUD BONUS', 'OBSIDIAN POST RAISED', 'MAGMA JACKPOT', 'MAGMA CHAMBER AWAKENED', 'MOLTEN CORE — EXTRA BALL LIT']
export const MULTIPLIERS = [1, 2, 4, 6, 8]
export const SKILL_AWARDS = [10_000, 25_000, 50_000, 100_000, 50_000, 25_000]
const BOOSTER_NAMES = ['JACKPOT BUILDING', 'ASH VANES SUPERHEATED', 'BONUS BUILDING', 'BONUS LOCKED']
const BASE_BONUS = 15_000
const BASE_JACKPOT = 25_000
const BONUS_CAP = 6_000_000
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
/** Pressure bleeds faster as it falls: 18 s at full, 8 s for the last light. */
const bleedInterval = (topLit: number) => 8 + 2 * topLit

/** Arc-length sampler for a guided path; renderer and physics share the same centerline. */
function guidedPath(path: readonly Vec3[]) {
  const lengths = [0]
  for (let i = 1; i < path.length; i++) {
    const [ax, ay, az] = path[i - 1]
    const [bx, by, bz] = path[i]
    lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay, bz - az))
  }
  const total = lengths[lengths.length - 1]
  const sample = (distance: number): Vec3 => {
    const d = clamp(distance, 0, total)
    let i = 1
    while (i < lengths.length - 1 && lengths[i] < d) i++
    const t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1)
    const a = path[i - 1]
    const b = path[i]
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  }
  return { total, sample }
}

const RAMP = guidedPath(RAMP_PATH)
const HABITRAIL = guidedPath(HABITRAIL_PATH)
export const sampleRamp = RAMP.sample
/** Wire habitrail speed, in table units per second. */
const HABITRAIL_SPEED = 5

/** Fixed-step simulation of the Eruption table. Renderers read public fields each frame. */
export class VolcanoGame implements TableGame {
  readonly ball: VolcanoBall = { x: SERVE.x, y: BALL_Y, z: SERVE.z, vx: 0, vz: 0 }
  readonly balls: readonly VolcanoBall[] = [this.ball]
  leftAngle: number = FLIPPER.rest
  rightAngle: number = FLIPPER.rest
  charge = 0
  centerPostUp = false
  readonly bumperFlashes = BUMPERS.map(() => 0)
  readonly targetFlashes = TARGETS.map(() => 0)
  readonly targetLit = TARGETS.map(() => false)
  readonly dropsDown = DROPS.map(() => false)
  readonly rolloverFlashes = ROLLOVERS.map(() => 0)
  readonly summitLit = [false, false, false]
  readonly craterLit = [false, false, false]
  readonly spinnerAngles = SPINNERS.map(() => 0)
  readonly kickersArmed = [false, false]
  readonly saucerFlashes = SAUCERS.map(() => 0)
  readonly tubeFlashes = TUBES.map(() => 0)
  readonly slingFlashes = [0, 0]
  readonly pressureLit = [true, true, true, true, true, true]
  readonly returnLit = [false, false]
  ventLevel = 0
  fountainLevel = 0
  badgeLevel = 0
  tubeOpen = false
  tubeExit = 0
  chamberActive = false

  private state: VolcanoSnapshot
  private listeners = new Set<() => void>()
  private events: VolcanoEvent[] = []
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
  private rolloverInside = ROLLOVERS.map(() => false)
  private kickerInside = [false, false]
  private spinnerVelocity = SPINNERS.map(() => 0)
  private spinnerHalfTurns = SPINNERS.map(() => 0)
  private dropResetAt = [0, 0, 0]
  private capture: Capture | null = null
  private captureCooldown = 0
  private onRim = false
  private rimLane = false
  private verticalSpeed = 0
  private stillSince = 0
  private chamberCooldown = 0
  private deploying = false
  private deploymentLights = 0
  private pressureBleedAt = 0
  private reflexUntil = 0
  private craterReflexUntil = 0
  private extraBallUntil = 0
  private centerPostUntil = 0
  private eruptionUntil = 0
  private ventUntil = 0
  private fountainUntil = 0
  private multiplierUntil = 0
  private badgeUntil = 0
  private vanesUntil = 0
  private boosterUntil = [0, 0, 0, 0]
  private bonusLit = false
  private replayAwarded = false
  private replayBall = false
  private bonusValue = BASE_BONUS
  private jackpotValue = BASE_JACKPOT
  private best = 0
  private randomState = 0x1a7a5eed

  constructor() {
    try {
      const stored = Number(globalThis.localStorage?.getItem(BEST_KEY))
      if (Number.isFinite(stored) && stored >= 0) this.best = Math.floor(stored)
    } catch { /* Storage can be disabled. */ }
    this.state = Object.freeze(this.freshSnapshot())
  }

  private freshSnapshot(): VolcanoSnapshot {
    return {
      status: 'ready', score: 0, best: this.best, ballNumber: 1, multiplier: 1, combo: 0, charge: 0,
      message: 'HOLD SPACE TO LAUNCH', launchReady: true, hits: 0, ballSave: false, tilted: false,
      rank: 0, rankProgress: 0, selectedExpedition: null, expeditionStage: 0, replay: false, expedition: null,
      expeditionProgress: 0, expeditionReady: false, pressure: 6, eruption: 0, extraBalls: 0, bonus: null,
    }
  }

  getSnapshot = (): VolcanoSnapshot => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  consumeEvents(): VolcanoEvent[] {
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
      case 'pressure': return on(this.pressureLit[index]) * (index === this.pressureLit.lastIndexOf(true) && this.pressureBleedAt - this.elapsed < 2 ? blink(5) : 1)
      case 'pressureTarget': return on(this.targetLit[index])
      case 'fissure': return on(index < MULTIPLIERS.indexOf(s.multiplier))
      case 'fumarole': return on(this.returnLit.some(Boolean))
      case 'hazard': return on(this.targetLit[7 + index])
      case 'summit': return on(this.summitLit[index])
      case 'craterLanes': return on(this.craterLit[index])
      case 'reflex': return this.elapsed < (index ? this.craterReflexUntil : this.reflexUntil) ? blink(5) : 0
      case 'tremor': return s.expedition === 15 && s.expeditionStage === 1 ? blink(3) : 0
      case 'expeditionAccept': return s.expeditionReady && s.pressure > 0 ? blink(3) : 0
      case 'surveyTarget': return on(this.targetLit[3 + index])
      case 'tilt': return on(s.tilted)
      case 'extraBall': return this.elapsed < this.extraBallUntil ? blink(2) : 0
      case 'bonusLane': return on(this.bonusLit)
      case 'returnLane': return on(this.returnLit[index])
      case 'outLane': return on(this.elapsed < this.extraBallUntil)
      case 'kicker': return on(this.kickersArmed[index])
      case 'replay': return on(this.replayAwarded)
      case 'eruption': return on(index < s.eruption)
      case 'craterRing': return this.saucerFlashes[0]
      case 'lavaLake': return this.saucerFlashes[1]
      case 'escape': return this.saucerFlashes[2]
      case 'tube': return Math.max(this.tubeFlashes[index], on(this.tubeOpen))
      case 'tubeExit': return on(this.tubeOpen)
      case 'tubeTarget': return on(this.tubeOpen)
      case 'badge': return on(index < this.badgeLevel)
      case 'cataclysm': return s.expedition === 16 ? blink(4) : 0
      case 'deployment': return !this.replayBall ? on(index < this.deploymentLights) : 0
      case 'deploymentArrow': return s.launchReady && !this.replayBall ? on(Math.floor(this.elapsed * 8) % 9 === index) : 0
      case 'booster': return on(this.boosterUntil[index] > this.elapsed)
      case 'vane': return on(this.vanesUntil > this.elapsed)
      case 'rank': return on(index <= s.rank)
      case 'progress': return on(index < s.rankProgress)
      case 'redeploy': return s.ballSave ? (this.saveUntil - this.elapsed < 3 ? blink(8) : 1) : 0
      case 'chamber': return this.chamberActive ? blink(3) : 0
      case 'centerPost': return this.centerPostUp ? this.centerPostUntil - this.elapsed < 3 ? blink(5) : 1 : 0
      case 'expeditionArrow': {
        if (s.expedition === null) return 0
        const step = EXPEDITIONS[s.expedition].steps[s.expeditionStage]
        if (step.requires === 'vents' && !this.ventLevel) return index === 1 ? blink(3) : 0
        if (step.requires === 'fountains' && !this.fountainLevel) return index === 0 || index === 13 ? blink(3) : 0
        if (step.requires === 'vanes' && this.vanesUntil <= this.elapsed) return index === 3 ? blink(3) : 0
        const arrows: Partial<Record<ExpeditionKind, number[]>> = {
          ramp: [0], summit: [1], vent: [2, 10], boulder: [10], drop: [3], spot: [4, 5], target: [3, 4, 5],
          lane: [0, 1, 11, 12], out: [11, 12], vanes: [17], fumarole: [9], pressure: [8],
          tube: [14, 15, 16], magma: [14], obsidian: [15], sulfur: [16], crater: [6], lavaLake: [7],
          ash: [4], bomb: [5], rebound: [18], tremor: [0, 6],
        }
        return arrows[step.kind]?.includes(index) ? blink(3) : 0
      }
    }
  }

  private patch(change: Partial<VolcanoSnapshot>): void {
    if (Object.entries(change).every(([key, value]) => this.state[key as keyof VolcanoSnapshot] === value)) return
    this.state = Object.freeze({ ...this.state, ...change })
    for (const listener of this.listeners) listener()
  }

  private emit(type: VolcanoEventType, x: number, z: number, value?: number): void {
    this.events.push({ id: ++this.eventId, type, x, z, value })
    if (this.events.length > 80) this.events.shift()
  }

  private announce(message: string, duration = 2.4): void {
    this.messageUntil = this.elapsed + duration
    this.patch({ message })
  }

  private idleMessage(): string {
    const s = this.state
    if (!s.pressure) return 'BUILD PRESSURE'
    if (s.expedition !== null) {
      const step = EXPEDITIONS[s.expedition].steps[s.expeditionStage]
      return `${step.brief.toUpperCase()} ${s.expeditionProgress}/${step.goal}`
    }
    return s.selectedExpedition !== null ? `CLIMB THE RIM RAMP TO START ${EXPEDITIONS[s.selectedExpedition].name.toUpperCase()}` : 'HIT SURVEY TARGETS TO PLAN AN EXPEDITION'
  }

  private score(points: number, field = true): number {
    if (this.state.tilted) return 0
    const value = Math.round(points * (field ? this.state.multiplier : 1))
    if (field) {
      if (this.boosterUntil[0] > this.elapsed) this.jackpotValue += points
      if (this.boosterUntil[2] > this.elapsed || this.boosterUntil[3] > this.elapsed) this.bonusValue = Math.min(BONUS_CAP, this.bonusValue + points)
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
    // Flipper presses rotate the lit summit and crater lanes (lane change).
    if (pressed && !wasPressed && this.state.status === 'playing' && !this.state.tilted) {
      for (const lit of [this.summitLit, this.craterLit]) {
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
    this.saveUntil = this.elapsed + LAVA_SHIELD
    if (this.pressureBleedAt === 0) this.pressureBleedAt = this.elapsed + 12
    this.patch({ status: 'playing', launchReady: false, charge: 0, ballSave: true })
    this.announce(this.replayBall ? 'LAVA SHIELD BALL' : 'MAGMA SURGE — SKILL SHOT LIVE', 2.6)
  }

  private launch(power: number): void {
    Object.assign(this.ball, { x: SERVE.x, y: BALL_Y, z: SERVE.z, vx: 0, vz: -(3 + power * 15.5) })
    this.stillSince = this.elapsed
    this.deploying = true
    this.deploymentLights = 0
    this.emit('launch', this.ball.x, this.ball.z, power)
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
    this.boosterUntil.fill(0)
    this.bonusValue = BASE_BONUS
    this.wallUntil = this.bonusElapsed = this.bonusTickAt = 0
    this.elapsed = this.accumulator = 0
    this.saveUntil = this.comboUntil = this.messageUntil = this.slingUntil = 0
    this.lastNudge = -10
    this.nudges = []
    for (const list of [this.bumperFlashes, this.bumperCooldowns, this.targetFlashes, this.targetCooldowns, this.rolloverFlashes,
      this.spinnerAngles, this.spinnerVelocity, this.slingFlashes, this.spinnerHalfTurns, this.saucerFlashes, this.tubeFlashes, this.flipperUntil, this.dropResetAt]) list.fill(0)
    this.resetTable()
    this.captureCooldown = this.chamberCooldown = 0
    this.events = []
    this.leftPressed = this.rightPressed = false
    this.leftAngle = this.rightAngle = FLIPPER.rest
    this.centerPostUp = false
    this.randomState = 0x1a7a5eed
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
      this.emit('tilt', this.ball.x, this.ball.z)
      return
    }
    if (!this.capture) {
      this.ball.vz -= 3.1
      this.ball.vx += (this.ball.x > -0.25 ? -1 : 1) * (1.1 + this.random() * 0.5)
    }
    this.emit('nudge', this.ball.x, this.ball.z)
    this.announce(this.nudges.length === 2 ? 'TREMOR WARNING — EASY' : 'TABLE NUDGED', 1.5)
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
    fade(this.tubeFlashes, 1.2)
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
    this.stepBall(dt, (this.leftAngle - prevLeft) / dt, (this.rightAngle - prevRight) / dt)
  }

  private stepBall(dt: number, leftVelocity: number, rightVelocity: number): void {
    const ball = this.ball
    if (this.capture) {
      this.updateCapture(dt)
      return
    }

    ball.vz += GRAVITY * dt
    if (ball.y < BALL_Y + 0.1) this.applyChamberPull(dt)
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

    if (this.onRim && !onCraterRim(ball.x, ball.z)) {
      this.onRim = false
      // The caldera has one open edge: it drops onto the wire habitrail to the right inlane.
      this.capture = { kind: 'habitrail', distance: 0 }
      this.reflexUntil = this.elapsed + 8
      return
    }
    if (this.onRim) {
      const inLanes = ball.z >= RIM_LANES.z0 && ball.z <= RIM_LANES.z1
      if (inLanes && !this.rolloverInside[15]) {
        if (!this.rimLane) { this.rimLane = true; this.awardRamp() }
        let lane = 0
        RIM_LANES.x.forEach((x, i) => { if (Math.abs(ball.x - x) < Math.abs(ball.x - RIM_LANES.x[lane])) lane = i })
        this.hitCraterLane(lane)
      }
      this.rolloverInside[15] = inLanes
    }
    if (this.onRim) ball.y = DECK_Y + BALL_Y
    else if (ball.y > BALL_Y) {
      this.verticalSpeed -= 12 * dt
      ball.y = Math.max(BALL_Y, ball.y + this.verticalSpeed * dt)
    } else this.verticalSpeed = 0
    const ground = ball.y < BALL_Y + 0.12

    if (this.deploying) {
      if (ball.x > 2.85) this.deploymentLights = Math.max(this.deploymentLights, clamp(Math.floor((4.85 - ball.z) / .62) + 1, 0, 6))
      if (ball.z < -2.6) this.deploying = false
      else if (ball.vz > 0 && ball.z > 4.65) {
        if (!this.replayBall && this.deploymentLights > 0) {
          const value = this.score(SKILL_AWARDS[this.deploymentLights - 1])
          this.announce(`SKILL SHOT +${value.toLocaleString('en-US')}`)
        }
        this.deploying = false
        Object.assign(ball, { x: 2.55, z: 4.8, vx: -5, vz: -3 })
        this.advanceExpedition('lane')
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
      this.serve()
      this.patch({ launchReady: true })
      this.announce('BALL RETURNED — LAUNCH AGAIN', 999)
      return
    }
    if (ball.x > 2.85 && ball.z > 5.3 && ball.vz > 0) {
      this.serve()
      this.patch({ launchReady: true })
      this.announce('BALL IN CHUTE — LAUNCH AGAIN', 999)
      return
    }
    if (ball.z > DRAIN_Z || (ball.z > OUTLANE_DRAIN_Z && isOutlane(ball.x))) this.drain()
  }

  private moveFlipper(angle: number, pressed: boolean, dt: number): number {
    const raised = pressed && !this.state.tilted
    const target = raised ? FLIPPER.raised : FLIPPER.rest
    const rate = raised ? 18 : 9
    return angle + clamp(target - angle, -rate * dt, rate * dt)
  }

  private applyChamberPull(dt: number): void {
    if (!this.chamberActive || this.state.tilted) return
    const ball = this.ball
    const dx = MAGMA_CHAMBER.x - ball.x, dz = MAGMA_CHAMBER.z - ball.z
    const dist = Math.hypot(dx, dz)
    if (dist > MAGMA_CHAMBER.radius || dist < .001) return
    ball.vx += dx / dist * 24 * dt
    ball.vz += dz / dist * 24 * dt
    ball.vx *= Math.exp(-5 * dt)
    ball.vz *= Math.exp(-5 * dt)
  }

  private collideSegment(segment: Segment): void {
    const ball = this.ball
    const bottom = segment.elevation ?? 0
    const top = bottom + (segment.height ?? .38)
    if (ball.y + BALL_RADIUS <= bottom || ball.y - BALL_RADIUS >= top) return
    const { a, b, kind } = segment
    const radius = BALL_RADIUS + (segment.radius ?? (kind === 'wall' ? .075 : .065))
    if (ball.x < Math.min(a[0], b[0]) - radius || ball.x > Math.max(a[0], b[0]) + radius ||
        ball.z < Math.min(a[1], b[1]) - radius || ball.z > Math.max(a[1], b[1]) + radius) return
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = clamp(((ball.x - a[0]) * dx + (ball.z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1)
    const px = a[0] + dx * t
    const pz = a[1] + dz * t
    const dist = Math.hypot(ball.x - px, ball.z - pz)
    if (dist >= radius) return
    const nx = dist > 0.00001 ? (ball.x - px) / dist : -dz / Math.hypot(dx, dz)
    const nz = dist > 0.00001 ? (ball.z - pz) / dist : dx / Math.hypot(dx, dz)
    // The chute gate only blocks balls falling back toward the plunger.
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
      const value = this.score(600)
      this.advanceExpedition('rebound')
      this.emit('sling', px, pz, value)
    } else if ((kind === 'wall' || kind === 'guide') && -incoming > 1.5 && this.elapsed > this.wallUntil) {
      this.wallUntil = this.elapsed + 0.06
      this.emit('wall', px, pz, -incoming)
    }
  }

  /** Plain post collision. Returns the impact speed, or 0 without a hit. */
  private collidePost(x: number, z: number, postRadius: number, restitution: number): number {
    const ball = this.ball
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
    const ball = this.ball
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
    const vent = bumper.kind === 'vent'
    const level = vent ? this.ventLevel : this.fountainLevel
    const value = this.score(index === 0 ? 2500 + level * 1250 : vent ? 750 + level * 750 : 1000 + level * 1000)
    this.emit('bumper', bumper.x, bumper.z, value)
    this.announce(`${index === 0 ? 'BOULDER' : vent ? 'VENT' : 'LAVA FOUNTAIN'} +${value}`, 1.6)
    if (vent) this.advanceExpedition(index === 0 ? 'boulder' : 'vent')
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
    this.score(target.group === 'survey' ? 1250 : 900)
    this.advanceExpedition('spot')
    if (target.group === 'survey') {
      if (this.state.expedition !== null) return
      this.targetLit[index] = true
      const all = this.targetLit.slice(3, 6).every(Boolean)
      const selectedExpedition = expeditionsForRank(this.state.rank)[all ? 3 : index - 3]
      if (all) this.targetLit.fill(false, 3, 6)
      this.bonusValue = Math.max(30_000, this.bonusValue)
      this.patch({ selectedExpedition, expeditionReady: true })
      this.announce(this.idleMessage())
      return
    }
    if (target.group === 'tube') {
      this.tubeOpen = true
      this.tubeExit = (this.tubeExit + 1) % 3
      this.targetLit[index] = true
      this.announce(`LAVA TUBES OPEN — ${TUBES[this.tubeExit].name.toUpperCase()} EXIT`)
      return
    }
    this.targetLit[index] = true
    const start = target.group === 'pressure' ? 0 : target.group === 'ash' ? 7 : 10
    if (this.targetLit.slice(start, start + 3).every(Boolean)) {
      this.targetLit.fill(false, start, start + 3)
      if (target.group === 'pressure') this.repressurize()
      else {
        this.kickersArmed[target.group === 'ash' ? 0 : 1] = true
        this.advanceExpedition(target.group)
        this.announce(`${target.group === 'ash' ? 'LEFT' : 'RIGHT'} LAVA KICKBACK ARMED`)
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
    if (!complete) this.score(bank === 1 ? 2000 : 600)
    else {
      this.dropResetAt[bank] = this.elapsed + .7
      if (bank === 0) {
        this.patch({ multiplier: MULTIPLIERS[Math.min(4, MULTIPLIERS.indexOf(this.state.multiplier) + 1)] })
        this.multiplierUntil = this.elapsed + HEAT_WINDOW
        this.score(2000)
        this.announce(`FISSURE MULTIPLIER ${this.state.multiplier}×`)
      } else if (bank === 1) {
        this.badgeLevel = Math.min(3, this.badgeLevel + 1)
        this.badgeUntil = this.elapsed + AWARD_WINDOW
        if (this.badgeLevel === 3) this.awardExtraBall()
        else this.score(this.badgeLevel === 1 ? 25_000 : 75_000)
        this.announce(`${['BRONZE', 'SILVER', 'GOLD'][this.badgeLevel - 1]} GEOLOGY BADGE${this.badgeLevel === 3 ? ' — EXTRA BALL' : ''}`)
      } else {
        this.score(7500)
        const free = this.boosterUntil.findIndex(until => until <= this.elapsed)
        const next = free < 0 ? 3 : free
        this.boosterUntil[next] = this.elapsed + AWARD_WINDOW
        if (next === 1 || this.state.expedition === 5) this.vanesUntil = this.elapsed + AWARD_WINDOW
        this.announce(BOOSTER_NAMES[next])
      }
    }
    this.advanceExpedition('drop')
  }

  private collideFlipper(side: 'left' | 'right', angle: number, angularVelocity: number): void {
    const ball = this.ball
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
          const value = this.score(this.vanesUntil > this.elapsed ? 3000 : 400)
          if (this.tubeOpen) this.tubeExit = (this.tubeExit + 1) % 3
          this.advanceExpedition('vanes')
          this.emit('spinner', (spinner.x0 + spinner.x1) / 2, spinner.z, value)
        }
      }
    })
  }

  private checkSpinners(prevZ: number): void {
    const ball = this.ball
    SPINNERS.forEach((spinner, i) => {
      if (ball.x < spinner.x0 || ball.x > spinner.x1) return
      if ((prevZ - spinner.z) * (ball.z - spinner.z) > 0) return
      this.spinnerVelocity[i] = Math.min(60, this.spinnerVelocity[i] + Math.abs(ball.vz) * 2.4)
    })
  }

  private checkRollovers(): void {
    const ball = this.ball
    ROLLOVERS.forEach((rollover, i) => {
      if (rollover.kind === 'crater') return
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
    if (kind === 'summit') { this.hitSummit(index); return }
    if (kind === 'crater') { this.hitCraterLane(index - 15); return }
    if (kind === 'pressure') {
      const light = index - 9
      this.score(light === 5 && !this.pressureLit[light] ? 2000 : 750)
      if (light === 5) { this.repressurize(); this.advanceExpedition('pressure') }
      else if (!this.pressureLit[light]) {
        this.pressureLit[light] = true
        this.patch({ pressure: this.pressureLit.filter(Boolean).length })
        this.pressureBleedAt = this.elapsed + bleedInterval(this.pressureLit.lastIndexOf(true))
      }
      return
    }
    if (kind === 'fumarole') {
      this.returnLit.fill(true)
      this.advanceExpedition('fumarole')
      this.announce('FUMAROLE — RETURN LANES LIT')
      return
    }
    if (kind === 'bonus') {
      this.score(12_500)
      this.repressurize()
      if (this.bonusLit) { this.bonusLit = false; this.score(this.bonusValue, false); this.announce('ERUPTION BONUS COLLECTED') }
    } else if (kind === 'return') {
      const side = index === 6 ? 0 : 1
      this.score(this.returnLit[side] ? 30_000 : 4000)
      this.returnLit[side] = false
    } else if (kind === 'out') {
      this.score(15_000)
      if (this.elapsed < this.extraBallUntil) { this.extraBallUntil = 0; this.awardExtraBall() }
    }
    this.advanceExpedition(kind === 'out' ? 'out' : 'lane')
  }

  private hitSummit(index: number): void {
    this.score(2500)
    this.summitLit[index] = !this.summitLit[index]
    if (this.summitLit.every(Boolean)) {
      this.summitLit.fill(false)
      this.ventLevel = Math.min(3, this.ventLevel + 1)
      this.ventUntil = this.elapsed + HEAT_WINDOW
      this.announce(['VENTS SMOLDERING', 'VENTS GLOWING', 'VENTS WHITE-HOT'][this.ventLevel - 1])
    }
    this.advanceExpedition('summit')
  }

  private hitCraterLane(index: number): void {
    this.score(750)
    this.craterLit[index] = !this.craterLit[index]
    if (this.craterLit.every(Boolean)) {
      this.craterLit.fill(false)
      this.fountainLevel = Math.min(3, this.fountainLevel + 1)
      this.fountainUntil = this.elapsed + HEAT_WINDOW
      this.announce('LAVA FOUNTAINS RISING')
    }
    this.advanceExpedition('lane')
  }

  private checkKickers(): void {
    const ball = this.ball
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
      this.announce('LAVA KICKBACK', 1.6)
    })
  }

  private checkCaptures(): void {
    if (this.state.tilted) return
    const ball = this.ball
    const speed = Math.hypot(ball.vx, ball.vz)
    if (ball.x > RAMP_ENTRY.x0 && ball.x < RAMP_ENTRY.x1 && ball.z > RAMP_ENTRY.z0 && ball.z < RAMP_ENTRY.z1 && ball.vz < -2.5) {
      this.capture = { kind: 'ramp', distance: 0, speed: clamp(speed * 0.75, 7, 11) }
      this.emit('ramp', ball.x, ball.z)
      return
    }
    for (let i = 0; i < SAUCERS.length; i++) {
      const saucer = SAUCERS[i]
      if (Math.hypot(ball.x - saucer.x, ball.z - saucer.z) < saucer.radius && speed < (saucer.kind === 'crater' ? 20 : 14)) {
        this.capture = { kind: 'saucer', index: i, until: this.elapsed + 1.1 }
        this.saucerFlashes[i] = 1
        this.emit('kickout', saucer.x, saucer.z)
        this.awardSaucer(i)
        return
      }
    }
    for (let i = 0; i < TUBES.length; i++) {
      const tube = TUBES[i]
      if (Math.hypot(ball.x - tube.x, ball.z - tube.z) < tube.radius && speed < 12) {
        this.enterTube(i)
        return
      }
    }
    const inCore = Math.hypot(ball.x - MAGMA_CHAMBER.x, ball.z - MAGMA_CHAMBER.z) < .18
    if (this.chamberActive && inCore && speed < 2 && this.elapsed > this.chamberCooldown) {
      this.chamberActive = false
      this.chamberCooldown = this.elapsed + 1.2
      this.capture = { kind: 'chamber', until: this.elapsed + .6 }
      this.score(75_000)
      this.emit('chamber', MAGMA_CHAMBER.x, MAGMA_CHAMBER.z)
      this.announce('MAGMA CHAMBER BREACHED +75,000')
    }
  }

  private enterTube(index: number): void {
    const tube = TUBES[index]
    const ordered = this.state.expedition === 7
    const to = this.tubeOpen ? this.tubeExit : index
    const value = this.score(this.tubeOpen ? to === index ? 6000 : 9000 : 2500)
    if (this.tubeOpen && to === index && !ordered) {
      this.replayAwarded = true
      this.patch({ replay: true })
    }
    this.tubeOpen = false
    this.targetLit[6] = false
    this.capture = { kind: 'tube', from: index, to, phase: 'sink', until: this.elapsed + .45 }
    this.tubeFlashes[index] = 1
    this.emit('tube', tube.x, tube.z)
    this.announce(`${this.replayAwarded ? 'REPLAY AWARDED' : `${tube.name.toUpperCase()} TUBE`} +${value}`)
    this.advanceExpedition(tube.name)
  }

  private awardSaucer(index: number): void {
    const kind = SAUCERS[index].kind
    if (kind === 'crater') {
      const level = this.state.eruption
      const value = this.score(ERUPTION_AWARDS[level])
      if (this.elapsed < this.craterReflexUntil) this.score(25_000)
      this.eruptionUntil = this.elapsed + AWARD_WINDOW
      this.patch({ eruption: (level + 1) % 5 })
      if (level === 1) this.centerPostUntil = this.elapsed + AWARD_WINDOW
      if (level === 2) { this.score(this.jackpotValue, false); this.jackpotValue = BASE_JACKPOT }
      if (level === 3) this.chamberActive = true
      if (level === 4) this.extraBallUntil = this.elapsed + AWARD_WINDOW
      this.emit('eruption', SAUCERS[index].x, SAUCERS[index].z)
      this.announce(`${ERUPTION_NAMES[level]} +${value}`)
      this.advanceExpedition('crater')
    } else if (kind === 'lavaLake') {
      this.announce(`LAVA LAKE +${this.score(25_000)}`)
      this.advanceExpedition('lavaLake')
    } else this.announce('ESCAPE TUNNEL — RELAUNCHING')
  }

  private updateCapture(dt: number): void {
    const capture = this.capture!
    const ball = this.ball
    if (capture.kind === 'habitrail') {
      capture.distance += HABITRAIL_SPEED * dt
      const [x, y, z] = HABITRAIL.sample(capture.distance)
      Object.assign(ball, { x, y: BALL_Y + y, z, vx: 0, vz: 2 })
      if (capture.distance < HABITRAIL.total) return
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
      this.onRim = true
      this.rimLane = false
      this.verticalSpeed = 0
      return
    }
    if (capture.kind === 'saucer') {
      const saucer = SAUCERS[capture.index]
      ball.x += (saucer.x - ball.x) * Math.min(1, dt * 14)
      ball.z += (saucer.z - ball.z) * Math.min(1, dt * 14)
      ball.vx = ball.vz = 0
      ball.y = Math.max(BALL_Y - 0.13, ball.y - dt * 0.8)
      if (this.elapsed < capture.until) return
      if (saucer.kind === 'escape') {
        Object.assign(ball, { x: SERVE.x, y: BALL_Y, z: .8, vx: 0, vz: -15 })
        this.release(.6)
        return
      }
      const vx = saucer.eject[0] + (this.random() - .5) * .6
      const vz = saucer.eject[1]
      if (saucer.kind === 'crater') this.craterReflexUntil = this.elapsed + 8
      Object.assign(ball, { x: saucer.x, y: BALL_Y, z: saucer.z, vx, vz })
      this.emit('kickout', saucer.x, saucer.z)
      this.release(0.6)
      return
    }
    if (capture.kind === 'tube') {
      const tube = TUBES[capture.phase === 'sink' ? capture.from : capture.to]
      ball.vx = ball.vz = 0
      if (capture.phase === 'sink') {
        ball.x += (tube.x - ball.x) * Math.min(1, dt * 12)
        ball.z += (tube.z - ball.z) * Math.min(1, dt * 12)
        ball.y = Math.max(-0.2, ball.y - dt * 1.2)
        if (this.elapsed < capture.until) return
        Object.assign(ball, { x: TUBES[capture.to].x, z: TUBES[capture.to].z, y: -0.2 })
        this.capture = { ...capture, phase: 'rise', until: this.elapsed + 0.35 }
        this.tubeFlashes[capture.to] = 1
        return
      }
      ball.y = Math.min(BALL_Y, ball.y + dt * 1.4)
      if (this.elapsed < capture.until) return
      Object.assign(ball, { y: BALL_Y, vx: (this.random() - 0.5) * 3, vz: 2.5 })
      this.emit('tube', tube.x, tube.z)
      this.release(0.7)
      return
    }
    Object.assign(ball, { x: MAGMA_CHAMBER.x, z: MAGMA_CHAMBER.z, vx: 0, vz: 0 })
    if (this.elapsed < capture.until) return
    const angle = this.random() * Math.PI * 2
    ball.vx = Math.cos(angle) * 7; ball.vz = Math.sin(angle) * 7
    this.release(.7)
  }

  private release(cooldown: number): void {
    this.capture = null
    this.captureCooldown = this.elapsed + cooldown
    this.stillSince = this.elapsed
    this.rolloverInside.fill(false)
  }

  private awardRamp(): void {
    if (this.state.tilted) return
    const value = this.score(this.elapsed < this.reflexUntil ? 30_000 : 6000)
    this.emit('bonus', this.ball.x, this.ball.z)
    if (this.state.selectedExpedition !== null && this.state.pressure > 0) {
      this.acceptExpedition()
      return
    }
    this.announce(`RIM RAMP +${value}`)
    this.advanceExpedition('ramp')
  }

  private acceptExpedition(): void {
    const expedition = this.state.selectedExpedition
    if (expedition === null || !this.state.pressure || this.state.expedition !== null) return
    if (expedition === 3 || expedition === 14) { this.dropsDown.fill(false); this.dropResetAt.fill(0) }
    if (expedition === 14) { this.targetLit.fill(false); this.tubeOpen = false }
    if (expedition === 5) this.vanesUntil = 0
    if (expedition === 13) { this.ventLevel = 0; this.ventUntil = 0 }
    if (expedition === 8) this.targetLit.fill(false, 10, 13)
    if (expedition === 9) this.targetLit.fill(false, 7, 10)
    if (expedition === 10) { this.fountainLevel = 0; this.fountainUntil = 0 }
    this.targetLit.fill(false, 3, 6)
    this.patch({ expedition, selectedExpedition: null, expeditionReady: false, expeditionStage: 0, expeditionProgress: 0 })
    this.score(EXPEDITIONS[expedition].accept, false)
    this.emit('expedition', this.ball.x, this.ball.z)
    this.announce(`EXPEDITION STARTED: ${EXPEDITIONS[expedition].name.toUpperCase()}`)
  }

  private advanceExpedition(kind: ExpeditionKind): void {
    const s = this.state
    if (s.expedition === null || this.state.tilted) return
    const expedition = EXPEDITIONS[s.expedition], step = expedition.steps[s.expeditionStage]
    const match = step.kind === kind || step.kind === 'vent' && kind === 'boulder'
      || step.kind === 'target' && (kind === 'spot' || kind === 'drop')
      || step.kind === 'lane' && (kind === 'out' || kind === 'summit')
      || step.kind === 'tube' && ['magma', 'obsidian', 'sulfur'].includes(kind)
      || step.kind === 'tremor' && (kind === 'ramp' || kind === 'crater')
    if (!match || step.requires === 'vents' && !this.ventLevel || step.requires === 'fountains' && !this.fountainLevel || step.requires === 'vanes' && this.vanesUntil <= this.elapsed) return
    const progress = s.expeditionProgress + 1
    if (progress < step.goal) { this.patch({ expeditionProgress: progress }); return }
    if (s.expeditionStage < expedition.steps.length - 1) {
      this.patch({ expeditionStage: s.expeditionStage + 1, expeditionProgress: 0 })
      this.announce(this.idleMessage())
      return
    }
    let rank = s.rank, rankProgress = s.rankProgress
    if (s.expedition === 15 && kind === 'crater') rank = Math.max(0, rank - 1)
    else {
      rankProgress += expedition.progress
      if (s.expedition === 15) rank = Math.min(8, rank + 1)
      if (rankProgress >= 18) { rank = Math.min(8, rank + 1); rankProgress = 0 }
    }
    const value = this.score(expedition.award, false)
    this.bonusLit = true
    this.patch({ expedition: null, expeditionStage: 0, expeditionProgress: 0, rank, rankProgress })
    this.emit('rank', this.ball.x, this.ball.z, value)
    if (s.expedition === 16) {
      // Cataclysm lights every award bank at once.
      this.badgeLevel = 3; this.badgeUntil = this.elapsed + AWARD_WINDOW; this.awardExtraBall()
      this.boosterUntil.fill(this.elapsed + AWARD_WINDOW); this.vanesUntil = this.elapsed + AWARD_WINDOW
      this.patch({ multiplier: MULTIPLIERS[4], eruption: 4 }); this.multiplierUntil = this.elapsed + HEAT_WINDOW; this.eruptionUntil = this.elapsed + AWARD_WINDOW
      this.score(25_000 + 75_000 + 15_000 + 25_000 + 40_000 + 75_000)
      this.score(this.jackpotValue, false); this.jackpotValue = BASE_JACKPOT
      this.centerPostUntil = this.extraBallUntil = this.elapsed + AWARD_WINDOW
      this.chamberActive = true
    }
    this.announce(rank !== s.rank ? `${rank > s.rank ? 'PROMOTED' : 'DEMOTED'} TO ${RANKS[rank].toUpperCase()}` : `EXPEDITION COMPLETE +${value.toLocaleString('en-US')}`, 3.4)
  }

  private repressurize(): void {
    this.pressureLit.fill(true)
    this.patch({ pressure: 6 })
    this.pressureBleedAt = this.elapsed + bleedInterval(5)
    this.announce('PRESSURE RESTORED')
  }

  private awardExtraBall(): void {
    this.patch({ extraBalls: this.state.extraBalls + 1 })
    this.announce('EXTRA BALL')
  }

  private updateAwards(): void {
    if (this.pressureBleedAt && this.elapsed >= this.pressureBleedAt && this.state.pressure) {
      this.pressureLit[this.pressureLit.lastIndexOf(true)] = false
      const pressure = this.pressureLit.filter(Boolean).length
      this.patch({ pressure })
      this.pressureBleedAt = this.elapsed + bleedInterval(this.pressureLit.lastIndexOf(true))
      if (pressure === 1) this.announce('WARNING — PRESSURE CRITICAL')
      if (!pressure) {
        const active = this.state.expedition !== null
        if (this.state.expedition === 7) { this.tubeOpen = false; this.targetLit[6] = false }
        this.patch({ expedition: null, expeditionProgress: 0, expeditionStage: 0 })
        this.announce(active ? 'ERUPTION STALLED — BUILD PRESSURE' : 'BUILD PRESSURE')
      }
    }
    if (this.ventLevel && this.elapsed >= this.ventUntil) { this.ventLevel--; this.ventUntil = this.elapsed + HEAT_WINDOW }
    if (this.fountainLevel && this.elapsed >= this.fountainUntil) { this.fountainLevel--; this.fountainUntil = this.elapsed + HEAT_WINDOW }
    if (this.badgeLevel && this.elapsed >= this.badgeUntil) { this.badgeLevel--; this.badgeUntil = this.elapsed + AWARD_WINDOW }
    if (this.state.multiplier > 1 && this.elapsed >= this.multiplierUntil) { this.patch({ multiplier: MULTIPLIERS[MULTIPLIERS.indexOf(this.state.multiplier) - 1] }); this.multiplierUntil = this.elapsed + HEAT_WINDOW }
    if (this.state.eruption && this.elapsed >= this.eruptionUntil) { this.patch({ eruption: this.state.eruption - 1 }); this.eruptionUntil = this.elapsed + AWARD_WINDOW }
  }

  private resetTable(): void {
    const heldBonus = this.boosterUntil[3] > this.elapsed
    if (!heldBonus) this.bonusValue = BASE_BONUS
    this.jackpotValue = BASE_JACKPOT
    for (const lights of [this.targetLit, this.dropsDown, this.summitLit, this.craterLit, this.returnLit, this.kickersArmed]) lights.fill(false)
    this.pressureLit.fill(true)
    this.dropResetAt.fill(0); this.boosterUntil.fill(0)
    this.spinnerVelocity.fill(0)
    this.ventLevel = this.fountainLevel = this.badgeLevel = 0
    this.reflexUntil = this.craterReflexUntil = this.extraBallUntil = this.centerPostUntil = this.eruptionUntil = this.ventUntil = this.fountainUntil = this.multiplierUntil = this.badgeUntil = this.vanesUntil = this.pressureBleedAt = 0
    this.tubeOpen = this.chamberActive = this.replayAwarded = this.replayBall = this.bonusLit = false
    this.tubeExit = 0
    this.patch({ expedition: null, selectedExpedition: null, expeditionReady: false, expeditionProgress: 0, expeditionStage: 0, pressure: 6, multiplier: 1, eruption: 0, replay: false, ballSave: false })
  }

  private ballSearch(): void {
    const ball = this.ball
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
    Object.assign(this.ball, { x: SERVE.x, y: BALL_Y, z: SERVE.z, vx: 0, vz: 0 })
    this.capture = null
    this.onRim = false
    this.verticalSpeed = 0
    this.charge = 0
    this.charging = false
    this.saveUntil = 0
    this.nudges = []
    this.lastNudge = -10
    this.centerPostUp = false
    this.deploying = false
    this.deploymentLights = 0
    this.rolloverInside.fill(false)
    this.kickerInside.fill(false)
  }

  private drain(): void {
    this.emit('drain', this.ball.x, this.ball.z)
    const automatic = this.elapsed < this.saveUntil && !this.state.tilted
    const saved = automatic || this.replayAwarded && !this.state.tilted
    this.patch({ combo: 0, ballSave: false })
    if (saved) {
      if (!automatic) this.replayAwarded = false
      this.serve()
      this.centerPostUp = this.elapsed < this.centerPostUntil
      this.replayBall = true
      this.patch({ launchReady: true, replay: this.replayAwarded })
      this.announce(automatic ? 'LAVA SHIELD — USE PLUNGER' : 'REPLAY BALL — USE PLUNGER', 999)
      return
    }
    this.saveUntil = 0
    this.ball.vx = this.ball.vz = 0
    const total = this.state.tilted ? 0 : this.bonusValue
    if (!total) { this.finishBall(); return }
    this.bonusElapsed = this.bonusTickAt = 0
    this.patch({ bonus: { count: 0, total }, launchReady: false })
    this.announce('ERUPTION BONUS', 999)
  }

  private updateBonus(dt: number): void {
    const bonus = this.state.bonus!
    this.bonusElapsed += dt
    if (this.bonusElapsed >= 2.2) { this.finishBonus(); return }
    if (this.bonusElapsed < this.bonusTickAt) return
    this.bonusTickAt = this.bonusElapsed + 0.08
    const count = Math.floor(bonus.total * this.bonusElapsed / 2.2)
    this.patch({ bonus: { ...bonus, count } })
    this.emit('bonusTick', this.ball.x, this.ball.z, count)
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
    this.emit('bonusTick', this.ball.x, this.ball.z, bonus.total)
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
      this.ball.vx = this.ball.vz = 0
      this.patch({ status: 'gameover', launchReady: false, message: `FINAL RANK: ${RANKS[this.state.rank].toUpperCase()}` })
    }
  }
}
