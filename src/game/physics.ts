export const BALL_RADIUS = 0.16;
export const BALLS_PER_GAME = 3;
export const FLIPPER_LENGTH = 1.12;
export const FLIPPER_RADIUS = 0.16;
export const FLIPPER_TIP_RADIUS = 0.1;
export const FLIPPER_PIVOT_Z = 3.65;
export const FLIPPER_REST = 0.38;
export const FLIPPER_RAISED = -0.5;

export type Point = readonly [number, number];
export type Rail = { a: Point; b: Point; kind: 'wall' | 'sling' | 'guide'; radius?: number };
export const LAUNCH_GATE = {
  a: [2.44, -3.7], b: [3.08, -3.7], kind: 'guide', radius: 0.055,
} as const satisfies Rail;
export const RAILS: readonly Rail[] = [
  { a: [-3.08, 5.45], b: [-3.08, -4.1], kind: 'wall' },
  { a: [-3.08, -4.1], b: [-2.75, -4.85], kind: 'wall' },
  { a: [-2.75, -4.85], b: [-2.1, -5.2], kind: 'wall' },
  { a: [-2.1, -5.2], b: [2.05, -5.2], kind: 'wall' },
  { a: [2.05, -5.2], b: [2.7, -4.83], kind: 'wall' },
  { a: [2.7, -4.83], b: [3.08, -4.1], kind: 'wall' },
  { a: [3.08, -4.1], b: [3.08, 5.45], kind: 'wall' },
  { a: [2.44, -3.7], b: [2.44, 5.45], kind: 'guide' },
  { a: [-2.35, 1], b: [-2.35, 2.5], kind: 'sling' },
  { a: [-2.35, 2.5], b: [-1.35, 2.9], kind: 'sling' },
  { a: [-1.35, 2.9], b: [-2.35, 1], kind: 'sling' },
  { a: [2.08, 1], b: [2.08, 2.5], kind: 'sling' },
  { a: [2.08, 2.5], b: [1.15, 2.9], kind: 'sling' },
  { a: [1.15, 2.9], b: [2.08, 1], kind: 'sling' },
  { a: [-2.73, 2.9], b: [-2.1, 3.34], kind: 'guide', radius: 0.16 },
  { a: [-2.1, 3.34], b: [-1.32, 3.65], kind: 'guide', radius: 0.16 },
  { a: [2.27, 2.9], b: [1.96, 3.395], kind: 'guide', radius: 0.16 },
  { a: [1.96, 3.395], b: [1.32, 3.65], kind: 'guide', radius: 0.16 },
];
export const BUMPERS = [
  { x: -1.12, z: -2.05, radius: 0.43 },
  { x: 1.05, z: -2.45, radius: 0.43 },
  { x: 0, z: -0.65, radius: 0.48 },
] as const;
export const TARGETS = [
  { x: -1.45, z: -3.72, radius: 0.24 },
  { x: 0, z: -3.72, radius: 0.24 },
  { x: 1.4, z: -3.72, radius: 0.24 },
] as const;

export type GameEvent = {
  id: number;
  type: 'bumper' | 'sling' | 'flipper' | 'launch' | 'drain' | 'nudge' | 'target' | 'tilt' | 'wall';
  x: number;
  z: number;
  value?: number;
};
export type Snapshot = Readonly<{
  status: 'ready' | 'playing' | 'paused' | 'gameover';
  score: number;
  best: number;
  ballNumber: number;
  multiplier: number;
  combo: number;
  charge: number;
  message: string;
  launchReady: boolean;
  hits: number;
  ballSave: false;
  tilted: boolean;
}>;

const STEP = 1 / 240;
const GRAVITY = 4.7;
const MAX_SPEED = 20;
const BEST_KEY = 'orbital-pinball-best';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A fixed-step table simulation. Renderers can read positions without React rerenders. */
export class PinballGame {
  readonly ball = { x: 2.77, z: 4.7, vx: 0, vz: 0 };
  leftAngle = FLIPPER_REST;
  rightAngle = FLIPPER_REST;
  charge = 0;
  launchGateClosed = false;
  readonly bumperFlashes = [0, 0, 0];
  readonly targetLights = [false, false, false];

  private state: Snapshot;
  private listeners = new Set<() => void>();
  private events: GameEvent[] = [];
  private eventId = 0;
  private accumulator = 0;
  private elapsed = 0;
  private charging = false;
  private leftPressed = false;
  private rightPressed = false;
  private savedStatus: Snapshot['status'] = 'ready';
  private comboUntil = 0;
  private messageUntil = 0;
  private lastNudge = -10;
  private nudges: number[] = [];
  private bumperCooldowns = [0, 0, 0];
  private targetCooldowns = [0, 0, 0];
  private slingUntil = 0;
  private flipperUntil = [0, 0];
  private wallUntil = 0;
  private best = 0;
  private randomState = 0x91a0f13;

  constructor() {
    try {
      const stored = Number(globalThis.localStorage?.getItem(BEST_KEY));
      if (Number.isFinite(stored) && stored >= 0) this.best = Math.floor(stored);
    } catch { /* Private browsing and server rendering can disable storage. */ }
    this.state = Object.freeze({
      status: 'ready', score: 0, best: this.best, ballNumber: 1, multiplier: 1,
      combo: 0, charge: 0, message: 'HOLD SPACE TO LAUNCH', launchReady: true,
      hits: 0, ballSave: false, tilted: false,
    });
  }

  getSnapshot = (): Snapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  consumeEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private patch(change: Partial<Snapshot>): void {
    if (Object.entries(change).every(([key, value]) => this.state[key as keyof Snapshot] === value)) return;
    this.state = Object.freeze({ ...this.state, ...change });
    for (const listener of this.listeners) listener();
  }

  private emit(type: GameEvent['type'], x: number, z: number, value?: number): void {
    this.events.push({ id: ++this.eventId, type, x, z, value });
    if (this.events.length > 80) this.events.shift();
  }

  private announce(message: string, duration = 2.4): void {
    this.messageUntil = this.elapsed + duration;
    this.patch({ message });
  }

  private score(points: number): number {
    const value = Math.round(points * this.state.multiplier);
    const score = this.state.score + value;
    if (score > this.best) {
      this.best = score;
      try { globalThis.localStorage?.setItem(BEST_KEY, String(score)); } catch { /* Storage is optional. */ }
    }
    this.patch({ score, best: this.best });
    return value;
  }

  private random(): number {
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    return (this.randomState >>> 0) / 4294967296;
  }

  setFlipper(side: 'left' | 'right', pressed: boolean): void {
    if (side === 'left') this.leftPressed = pressed;
    else this.rightPressed = pressed;
  }

  startCharge(): void {
    if (!this.state.launchReady || this.state.status === 'paused' || this.state.status === 'gameover') return;
    this.charging = true;
  }

  cancelCharge(): void {
    this.charging = false;
    this.charge = 0;
    this.patch({ charge: 0 });
  }

  releaseCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    if (!this.state.launchReady || this.state.status === 'paused' || this.state.status === 'gameover') {
      this.charge = 0;
      this.patch({ charge: 0 });
      return;
    }
    const power = this.charge;
    this.ball.x = 2.77;
    this.ball.z = 4.7;
    this.ball.vx = 0;
    this.ball.vz = -(17.5 + power * 6.1);
    this.charge = 0;
    this.launchGateClosed = false;
    this.patch({ status: 'playing', launchReady: false, charge: 0 });
    this.announce(`BALL ${this.state.ballNumber} OF ${BALLS_PER_GAME} IN PLAY`, 2.6);
    this.emit('launch', this.ball.x, this.ball.z, power);
  }

  togglePause(): void {
    if (this.state.status === 'gameover') return;
    if (this.state.status === 'paused') {
      this.patch({ status: this.savedStatus });
    } else {
      this.savedStatus = this.state.status;
      this.charging = false;
      this.charge = 0;
      this.leftPressed = this.rightPressed = false;
      this.patch({ status: 'paused', charge: 0 });
    }
    this.accumulator = 0;
  }

  newGame(): void {
    this.elapsed = 0;
    this.accumulator = 0;
    this.comboUntil = this.messageUntil = 0;
    this.lastNudge = -10;
    this.nudges = [];
    this.bumperCooldowns.fill(0);
    this.targetCooldowns.fill(0);
    this.bumperFlashes.fill(0);
    this.targetLights.fill(false);
    this.flipperUntil.fill(0);
    this.slingUntil = this.wallUntil = 0;
    this.events = [];
    this.leftPressed = this.rightPressed = false;
    this.leftAngle = this.rightAngle = FLIPPER_REST;
    this.randomState = 0x91a0f13;
    this.serve();
    this.patch({
      status: 'ready', score: 0, best: this.best, ballNumber: 1, multiplier: 1,
      combo: 0, charge: 0, message: 'HOLD SPACE TO LAUNCH', launchReady: true,
      hits: 0, ballSave: false, tilted: false,
    });
  }

  nudge(): void {
    if (this.state.status !== 'playing' || this.state.launchReady || this.state.tilted) return;
    if (this.elapsed - this.lastNudge < 0.45) return;
    this.lastNudge = this.elapsed;
    this.nudges = this.nudges.filter(time => this.elapsed - time < 5);
    this.nudges.push(this.elapsed);
    if (this.nudges.length >= 3) {
      this.patch({ tilted: true, combo: 0 });
      this.announce('TILT — FLIPPERS LOCKED', 999);
      this.emit('tilt', this.ball.x, this.ball.z);
      return;
    }
    this.ball.vz -= 3.1;
    this.ball.vx += (this.ball.x > 0 ? -1 : 1) * (1.1 + this.random() * 0.5);
    this.emit('nudge', this.ball.x, this.ball.z);
    this.announce(this.nudges.length === 2 ? 'CAREFUL — TILT WARNING' : 'TABLE NUDGED', 1.5);
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0 || this.state.status === 'paused' || this.state.status === 'gameover') return;
    // Drop long background-tab gaps rather than simulating an unseen lost ball.
    this.accumulator += Math.min(delta, 0.1);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      this.step(STEP);
    }
    this.patch({ charge: Math.round(this.charge * 100) / 100 });
  }

  private step(dt: number): void {
    this.elapsed += dt;
    for (let i = 0; i < this.bumperFlashes.length; i++) this.bumperFlashes[i] = Math.max(0, this.bumperFlashes[i] - dt * 3.4);
    if (this.charging) this.charge = Math.min(1, this.charge + dt / 1.05);
    if (this.state.combo && this.elapsed > this.comboUntil) this.patch({ combo: 0 });
    if (this.messageUntil > 0 && this.elapsed > this.messageUntil && !this.state.launchReady && !this.state.tilted) {
      this.messageUntil = 0;
      this.patch({ message: 'LIGHT THE THREE ORBITS' });
    }

    const prevLeft = this.leftAngle;
    const prevRight = this.rightAngle;
    this.leftAngle = this.moveFlipper(this.leftAngle, this.leftPressed, dt);
    this.rightAngle = this.moveFlipper(this.rightAngle, this.rightPressed, dt);
    if (this.state.launchReady || this.state.status !== 'playing') return;

    const ball = this.ball;
    ball.vz += GRAVITY * dt;
    const drag = Math.exp(-0.055 * dt);
    ball.vx *= drag;
    ball.vz *= drag;
    const speed = Math.hypot(ball.vx, ball.vz);
    if (speed > MAX_SPEED) {
      ball.vx *= MAX_SPEED / speed;
      ball.vz *= MAX_SPEED / speed;
    } else if (speed > 0 && speed < 3) {
      // Rolling resistance: slow balls settle instead of creeping forever.
      const slowed = Math.max(0, speed - 0.35 * dt) / speed;
      ball.vx *= slowed;
      ball.vz *= slowed;
    }
    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;

    // Raise the panel only once the entire ball clears the lane mouth. It stays
    // closed for this ball, so neither a rebound nor a nudge can reopen the lane.
    const gateClearance = BALL_RADIUS + LAUNCH_GATE.radius;
    if (!this.launchGateClosed && ball.z + gateClearance < LAUNCH_GATE.a[1]) {
      this.launchGateClosed = true;
    }

    // At the maximum speed a substep is 0.1 units, below the ball radius.
    // Two constraint passes resolve shared rail vertices without tunneling.
    for (let pass = 0; pass < 2; pass++) {
      for (const rail of RAILS) this.collideRail(rail);
      if (this.launchGateClosed) this.collideRail(LAUNCH_GATE);
      this.collideFlipper('left', this.leftAngle, (this.leftAngle - prevLeft) / dt);
      this.collideFlipper('right', this.rightAngle, (this.rightAngle - prevRight) / dt);
      BUMPERS.forEach((bumper, index) => this.collideBumper(bumper, index));
    }
    TARGETS.forEach((target, index) => {
      if (this.state.tilted || this.elapsed < this.targetCooldowns[index]) return;
      if (Math.hypot(ball.x - target.x, ball.z - target.z) < target.radius + BALL_RADIUS) {
        this.targetCooldowns[index] = this.elapsed + 0.7;
        this.targetLights[index] = true;
        const value = this.score(250);
        this.emit('target', target.x, target.z, value);
        if (this.targetLights.every(Boolean)) {
          this.targetLights.fill(false);
          this.patch({ multiplier: Math.min(5, this.state.multiplier + 1) });
          this.score(1000);
          this.announce(`ORBIT COMPLETE — ${this.state.multiplier}× MULTIPLIER`, 3);
        } else this.announce('ORBIT LIT +250', 1.5);
      }
    });
    if (ball.z > 5.65) this.drain();
  }

  private moveFlipper(angle: number, pressed: boolean, dt: number): number {
    const raised = pressed && !this.state.tilted;
    const target = raised ? FLIPPER_RAISED : FLIPPER_REST;
    const rate = raised ? 18 : 9;
    return angle + clamp(target - angle, -rate * dt, rate * dt);
  }

  private collideRail(rail: Rail): void {
    const ball = this.ball;
    const dx = rail.b[0] - rail.a[0];
    const dz = rail.b[1] - rail.a[1];
    const t = clamp(((ball.x - rail.a[0]) * dx + (ball.z - rail.a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const px = rail.a[0] + dx * t;
    const pz = rail.a[1] + dz * t;
    const dist = Math.hypot(ball.x - px, ball.z - pz);
    const radius = BALL_RADIUS + (rail.radius ?? (rail.kind === 'wall' ? 0.075 : 0.065));
    if (dist >= radius) return;
    const nx = dist > 0.00001 ? (ball.x - px) / dist : -dz / Math.hypot(dx, dz);
    const nz = dist > 0.00001 ? (ball.z - pz) / dist : dx / Math.hypot(dx, dz);
    ball.x += nx * (radius - dist + 0.0001);
    ball.z += nz * (radius - dist + 0.0001);
    const incoming = ball.vx * nx + ball.vz * nz;
    if (incoming >= 0) return;
    const sling = rail.kind === 'sling' && this.elapsed > this.slingUntil && !this.state.tilted && incoming < -0.6;
    // Glancing contacts slide along the rail instead of bouncing off it.
    const glancing = -incoming < 0.35 * Math.hypot(ball.vx, ball.vz);
    const restitution = sling ? 0.94 : glancing ? 0.1 : 0.55;
    const impulse = -(1 + restitution) * incoming + (sling ? 4.2 : 0);
    ball.vx += nx * impulse;
    ball.vz += nz * impulse;
    if (sling) {
      this.slingUntil = this.elapsed + 0.12;
      const value = this.score(50);
      this.emit('sling', px, pz, value);
    } else if (rail.kind !== 'sling' && -incoming > 1.5 && this.elapsed > this.wallUntil) {
      this.wallUntil = this.elapsed + 0.06;
      this.emit('wall', px, pz, -incoming);
    }
  }

  private collideBumper(bumper: { x: number; z: number; radius: number }, index: number): void {
    const ball = this.ball;
    const dx = ball.x - bumper.x;
    const dz = ball.z - bumper.z;
    const dist = Math.hypot(dx, dz);
    const radius = bumper.radius + BALL_RADIUS;
    if (dist >= radius) return;
    const nx = dist > 0.00001 ? dx / dist : 0;
    const nz = dist > 0.00001 ? dz / dist : 1;
    ball.x = bumper.x + nx * (radius + 0.0001);
    ball.z = bumper.z + nz * (radius + 0.0001);
    const incoming = ball.vx * nx + ball.vz * nz;
    if (incoming >= 0) return;
    const energized = !this.state.tilted && this.elapsed >= this.bumperCooldowns[index];
    const impulse = -incoming * 1.85 + (energized ? 5.5 : 0);
    ball.vx += nx * impulse;
    ball.vz += nz * impulse;
    if (energized) {
      this.bumperCooldowns[index] = this.elapsed + 0.1;
      this.bumperFlashes[index] = 1;
      const combo = this.elapsed < this.comboUntil ? Math.min(8, this.state.combo + 1) : 1;
      this.comboUntil = this.elapsed + 2.25;
      this.patch({ combo, hits: this.state.hits + 1 });
      const value = this.score(100 * combo);
      this.emit('bumper', bumper.x, bumper.z, value);
      this.announce(combo > 1 ? `${combo} HIT COMBO +${value}` : `REACTOR HIT +${value}`, 1.8);
    }
  }

  private collideFlipper(side: 'left' | 'right', angle: number, angularVelocity: number): void {
    const ball = this.ball;
    const sign = side === 'left' ? 1 : -1;
    const pivotX = side === 'left' ? -1.32 : 1.32;
    const ux = Math.cos(angle) * sign;
    const uz = Math.sin(angle);
    const distanceAlong = clamp((ball.x - pivotX) * ux + (ball.z - FLIPPER_PIVOT_Z) * uz, 0, FLIPPER_LENGTH);
    const px = pivotX + ux * distanceAlong;
    const pz = FLIPPER_PIVOT_Z + uz * distanceAlong;
    const dist = Math.hypot(ball.x - px, ball.z - pz);
    const taper = FLIPPER_RADIUS + (FLIPPER_TIP_RADIUS - FLIPPER_RADIUS) * distanceAlong / FLIPPER_LENGTH;
    const radius = BALL_RADIUS + taper;
    if (dist >= radius) return;
    const nx = dist > 0.00001 ? (ball.x - px) / dist : uz * sign;
    const nz = dist > 0.00001 ? (ball.z - pz) / dist : -ux * sign;
    ball.x += nx * (radius - dist + 0.0001);
    ball.z += nz * (radius - dist + 0.0001);
    const surfaceVX = -Math.sin(angle) * sign * angularVelocity * distanceAlong;
    const surfaceVZ = Math.cos(angle) * angularVelocity * distanceAlong;
    const incoming = (ball.vx - surfaceVX) * nx + (ball.vz - surfaceVZ) * nz;
    if (incoming >= 0) return;
    // Impulse depends on actual flipper motion. Holding a raised flipper cannot
    // continually inject energy, and a well-timed tip strike is strongest.
    const restitution = angularVelocity < -0.5 ? 0.72 : Math.abs(angularVelocity) < 0.5 ? 0.3 : 0.48;
    const impulse = -(1 + restitution) * incoming;
    ball.vx += impulse * nx;
    ball.vz += impulse * nz;
    const index = side === 'left' ? 0 : 1;
    if (this.elapsed > this.flipperUntil[index] && Math.abs(incoming) > 0.65) {
      this.flipperUntil[index] = this.elapsed + 0.075;
      this.emit('flipper', px, pz, Math.abs(incoming));
    }
  }

  private serve(): void {
    this.ball.x = 2.77;
    this.ball.z = 4.7;
    this.ball.vx = this.ball.vz = 0;
    this.charge = 0;
    this.charging = false;
    this.launchGateClosed = false;
    this.nudges = [];
    this.lastNudge = -10;
  }

  private drain(): void {
    if (this.state.status !== 'playing' || this.state.launchReady) return;
    this.emit('drain', this.ball.x, this.ball.z);
    this.patch({ combo: 0 });
    if (this.state.ballNumber < BALLS_PER_GAME) {
      this.serve();
      this.patch({ ballNumber: this.state.ballNumber + 1, launchReady: true, tilted: false });
      this.announce(`BALL ${this.state.ballNumber} OF ${BALLS_PER_GAME} - HOLD SPACE`, 999);
    } else {
      this.ball.vx = this.ball.vz = 0;
      this.patch({ status: 'gameover', launchReady: false, message: 'MISSION COMPLETE' });
    }
  }
}
