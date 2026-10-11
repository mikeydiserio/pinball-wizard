/**
 * Asset-free sound engine: synthesized sfx, a looping music scheduler, a rolling-ball loop and a
 * plunger spring creak. The AudioContext is created only on a user gesture (`unlock`).
 *
 * Mechanical sfx are built from three primitives so they read as hardware rather than synths:
 * `click` (a few ms of filtered noise: the contact), `ring` (fixed-pitch struck modes: steel and
 * plastic), and `thud` (a fast pitch-dropping sine: wood and coils). Everything then passes through
 * a short plywood-cabinet impulse response, which is what makes it sound like it lives in a machine.
 *
 * Graph:  voices -> (panner) -> sfx -> body EQ -> air EQ ------------------\
 *                                  \-> cabinet send -> cabinet (convolver) -+-> master -> compressor -> out
 *         music chain -> fade -> duck -> pauseFilter -> musicBus ----------/
 */
export type MusicTable = 'orbital' | 'cadet' | 'volcano'
export interface SoundOptions { x?: number; intensity?: number }

const MASTER = 0.5
const MUSIC_LEVEL = 0.35
// A pinball cabinet is close and dry. A little body resonance is enough; a long wet tail makes
// every hit sound like a game sound effect in a room instead of a mechanism under glass.
const CABINET_WET = 0.14
const VOICE_CAP = 36
const HARD_VOICE_CAP = 64
/** Context resume is async; sounds asked for this soon after `unlock` are scheduled anyway. */
const UNLOCK_GRACE_MS = 600
const DUCKING = new Set(['mission', 'expedition', 'rank', 'multiball', 'jackpot', 'hyperspace', 'eruption', 'bonus', 'gameover'])
/** Player-driven and must-hear cues skip the soft voice cap. */
const PRIORITY = new Set([...DUCKING, 'launch', 'drain', 'tilt', 'flipperUp', 'flipperDown'])
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const hash01 = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296

/** Plywood cabinet + playfield modes (Hz, decay time constant in s) every impact excites. */
const CABINET_MODES = [[94, 0.05], [141, 0.042], [203, 0.034], [276, 0.027], [368, 0.021], [512, 0.016], [688, 0.012], [935, 0.009]] as const

/** Where one play() call sends its voices, plus its per-call variation. */
interface Out { node: AudioNode; pitch: number; vol: number; music: boolean }
interface MusicChain { hi: GainNode; low: BiquadFilterNode; tone: BiquadFilterNode; fade: GainNode }
interface RollLoop {
  source: AudioBufferSourceNode
  rumble: BiquadFilterNode
  rumbleGain: GainNode
  grit: BiquadFilterNode
  gritGain: GainNode
  lfo: OscillatorNode
  lfoDepth: GainNode
  pan: StereoPannerNode
}

const ORBITAL_CHORDS = [
  { bass: 55, tones: [220, 261.63, 329.63, 440, 523.25, 659.25] },
  { bass: 43.65, tones: [174.61, 220, 261.63, 349.23, 440, 523.25] },
  { bass: 65.41, tones: [261.63, 329.63, 392, 523.25, 659.25, 783.99] },
  { bass: 49, tones: [196, 246.94, 293.66, 392, 493.88, 587.33] },
] as const
const CADET_CHORDS = [
  { bass: 82.41, tones: [329.63, 392, 493.88, 659.25] },
  { bass: 65.41, tones: [261.63, 329.63, 392, 523.25] },
  { bass: 98, tones: [392, 493.88, 587.33, 783.99] },
  { bass: 73.42, tones: [293.66, 369.99, 440, 587.33] },
] as const
const CADET_ARP = [0, 1, 2, 3, 2, 1, 3, 2] as const
/** D minor descent with a Phrygian lean: Dm, Bb, C, A. */
const VOLCANO_CHORDS = [
  { bass: 73.42, tones: [293.66, 349.23, 440, 587.33] },
  { bass: 58.27, tones: [233.08, 293.66, 349.23, 466.16] },
  { bass: 65.41, tones: [261.63, 329.63, 392, 523.25] },
  { bass: 55, tones: [220, 277.18, 329.63, 440] },
] as const
const ORBITAL_STEP = 60 / 84 / 2
const CADET_STEP = 60 / 116 / 2
const VOLCANO_STEP = 60 / 96 / 2
const STEP_SECONDS: Record<MusicTable, number> = { orbital: ORBITAL_STEP, cadet: CADET_STEP, volcano: VOLCANO_STEP }

export class PinballAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private sfx: GainNode | null = null
  private cabinet: ConvolverNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private muted = false
  private paused = false
  private unlockedAt = 0
  private sequence = 0
  private tickSequence = 0
  private voices = 0

  // Music
  private musicBus: GainNode | null = null
  private musicDuck: GainNode | null = null
  private musicPause: BiquadFilterNode | null = null
  private chain: MusicChain | null = null
  private musicTable: MusicTable | null = null
  private wantedMusic: MusicTable | null = null
  private musicTimer: ReturnType<typeof setInterval> | null = null
  private musicStep = 0
  private nextNoteTime = 0

  // Persistent loops
  private roll: RollLoop | null = null
  private rollState = { speed: -1, x: 0 }
  private plunger: { filter: BiquadFilterNode; gain: GainNode } | null = null
  private charge = 0
  private chargeNotch = 0

  unlock(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return
    if (!this.context) {
      try {
        const context = new AudioContext()
        this.context = context
        this.master = context.createGain()
        this.master.gain.value = this.muted ? 0 : MASTER
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.value = -14
        compressor.knee.value = 14
        compressor.ratio.value = 4
        compressor.attack.value = 0.002
        compressor.release.value = 0.12
        this.master.connect(compressor)
        compressor.connect(context.destination)

        // Dry path: a little low-mid body (the cabinet is a wooden box) and the digital fizz taken off the top.
        this.sfx = context.createGain()
        const body = context.createBiquadFilter()
        body.type = 'peaking'
        body.frequency.value = 170
        body.Q.value = 0.8
        body.gain.value = 3
        const air = context.createBiquadFilter()
        air.type = 'highshelf'
        air.frequency.value = 7500
        air.gain.value = -4
        this.sfx.connect(body)
        body.connect(air)
        air.connect(this.master)

        // Wet path: every hit rings the cabinet.
        const send = context.createGain()
        send.gain.value = CABINET_WET
        this.cabinet = context.createConvolver()
        this.cabinet.buffer = this.cabinetImpulse(context)
        this.sfx.connect(send)
        send.connect(this.cabinet)
        this.cabinet.connect(this.master)

        this.noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
        const noise = this.noiseBuffer.getChannelData(0)
        for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1

        this.musicBus = context.createGain()
        this.musicBus.gain.value = MUSIC_LEVEL * (this.paused ? 0.5 : 1)
        this.musicPause = context.createBiquadFilter()
        this.musicPause.type = 'lowpass'
        this.musicPause.frequency.value = this.paused ? 400 : 20000
        this.musicDuck = context.createGain()
        this.musicDuck.connect(this.musicPause)
        this.musicPause.connect(this.musicBus)
        this.musicBus.connect(this.master)
        document.addEventListener('visibilitychange', this.onVisibility)
      } catch {
        this.context = null
        return
      }
    }
    this.unlockedAt = performance.now()
    this.resumeContext()
    if (this.wantedMusic && !this.musicTimer) this.startMusic(this.wantedMusic)
  }

  /** A short stereo response of a plywood box: decaying cabinet modes over a burst of early reflections. */
  private cabinetImpulse(context: AudioContext): AudioBuffer {
    const rate = context.sampleRate
    const length = Math.floor(rate * 0.105)
    const buffer = context.createBuffer(2, length, rate)
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      const phases = CABINET_MODES.map(() => Math.random() * Math.PI * 2)
      const spread = 1 + channel * 0.006
      let smoothed = 0
      for (let i = 0; i < length; i++) {
        const t = i / rate
        let sample = 0
        for (let m = 0; m < CABINET_MODES.length; m++) {
          const [frequency, decay] = CABINET_MODES[m]
          sample += Math.sin(2 * Math.PI * frequency * spread * t + phases[m]) * Math.exp(-t / decay) / Math.sqrt(m + 1)
        }
        smoothed += 0.3 * ((Math.random() * 2 - 1) - smoothed)
        data[i] = sample * 0.22 + smoothed * Math.exp(-t / 0.004) * 0.7
      }
    }
    return buffer
  }

  private resumeContext(): void {
    const context = this.context
    if (!context) return
    const state = context.state as string
    if (state === 'suspended' || state === 'interrupted') void context.resume().catch(() => undefined)
  }

  private onVisibility = (): void => { if (!document.hidden) this.resumeContext() }

  /** Running, or still resuming from the gesture that just unlocked it (so the first flip is heard). */
  private audible(context: AudioContext): boolean {
    if (context.state === 'running') return true
    return context.state === 'suspended' && performance.now() - this.unlockedAt < UNLOCK_GRACE_MS
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.context && this.master) this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.context.currentTime, 0.025)
  }

  /** Pausing muffles and halves the music and silences the looped sfx. */
  setPaused(paused: boolean): void {
    this.paused = paused
    const context = this.context
    if (!context) return
    const now = context.currentTime
    this.musicPause?.frequency.setTargetAtTime(paused ? 400 : 20000, now, 0.08)
    this.musicBus?.gain.setTargetAtTime(MUSIC_LEVEL * (paused ? 0.5 : 1), now, 0.08)
    if (paused && this.roll) {
      this.roll.rumbleGain.gain.setTargetAtTime(0, now, 0.05)
      this.roll.gritGain.gain.setTargetAtTime(0, now, 0.05)
      this.roll.lfoDepth.gain.setTargetAtTime(0, now, 0.05)
      this.rollState.speed = -1
    }
    this.applyPlunger()
  }

  /**
   * Steel ball on a wooden playfield: a low rumble plus a quieter high grit, with a speed-linked
   * flutter from the playfield's inserts and seams. World x (about +-3.5) -> pan; speed01 is the
   * ball's normalized speed. Cheap to call every frame.
   */
  setRoll(speed01: number, x: number): void {
    const context = this.context
    if (!context || context.state !== 'running') return
    const speed = this.paused ? 0 : clamp(speed01, 0, 1)
    const last = this.rollState
    if (Math.abs(speed - last.speed) < 0.01 && Math.abs(x - last.x) < 0.05) return
    if (!this.roll) {
      if (!this.sfx || !this.noiseBuffer) return
      const source = context.createBufferSource()
      const rumble = context.createBiquadFilter()
      const rumbleGain = context.createGain()
      const grit = context.createBiquadFilter()
      const gritGain = context.createGain()
      const lfo = context.createOscillator()
      const lfoDepth = context.createGain()
      const pan = context.createStereoPanner()
      source.buffer = this.noiseBuffer
      source.loop = true
      rumble.type = 'lowpass'
      rumble.Q.value = 1.1
      grit.type = 'bandpass'
      grit.Q.value = 1.4
      rumbleGain.gain.value = 0
      gritGain.gain.value = 0
      lfoDepth.gain.value = 0
      lfo.type = 'sine'
      source.connect(rumble)
      rumble.connect(rumbleGain)
      rumbleGain.connect(pan)
      source.connect(grit)
      grit.connect(gritGain)
      gritGain.connect(pan)
      lfo.connect(lfoDepth)
      lfoDepth.connect(rumbleGain.gain)
      pan.connect(this.sfx)
      source.start(0, Math.random())
      lfo.start()
      this.roll = { source, rumble, rumbleGain, grit, gritGain, lfo, lfoDepth, pan }
    }
    last.speed = speed
    last.x = x
    const now = context.currentTime
    const rumbleLevel = Math.pow(speed, 1.4) * 0.11
    this.roll.rumble.frequency.setTargetAtTime(140 + speed * 460, now, 0.05)
    this.roll.rumbleGain.gain.setTargetAtTime(rumbleLevel, now, 0.05)
    this.roll.lfo.frequency.setTargetAtTime(5 + speed * 24, now, 0.05)
    this.roll.lfoDepth.gain.setTargetAtTime(rumbleLevel * 0.35, now, 0.05)
    this.roll.grit.frequency.setTargetAtTime(900 + speed * 1900, now, 0.05)
    this.roll.gritGain.gain.setTargetAtTime(Math.pow(speed, 1.7) * 0.03, now, 0.05)
    this.roll.pan.pan.setTargetAtTime(clamp(x / 3.2, -1, 1) * 0.75, now, 0.05)
  }

  /** Plunger pull: a rising spring creak plus a coil tick every notch of travel; 0 silences it. */
  setCharge(charge01: number): void {
    this.charge = clamp(charge01, 0, 1)
    const notch = Math.floor(this.charge * 7)
    const context = this.context
    if (notch > this.chargeNotch && context && this.sfx && !this.paused && !this.muted && this.audible(context)) {
      const out: Out = { node: this.sfx, pitch: 1 + notch * 0.02, vol: 0.5 + this.charge * 0.4, music: false }
      this.click(context.currentTime, out, 0.05, 3600, 2.5, 0.005)
      this.ring(2450, 0.03, 0.01, context.currentTime, out)
    }
    this.chargeNotch = notch
    this.applyPlunger()
  }

  private applyPlunger(): void {
    const context = this.context
    if (!context || !this.sfx || !this.noiseBuffer) return
    const active = this.charge > 0.001 && !this.paused
    if (!this.plunger) {
      if (!active) return
      const source = context.createBufferSource()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      source.buffer = this.noiseBuffer
      source.loop = true
      filter.type = 'bandpass'
      filter.Q.value = 6
      filter.frequency.value = 700
      gain.gain.value = 0
      source.connect(filter)
      filter.connect(gain)
      gain.connect(this.sfx)
      source.start(0, Math.random())
      this.plunger = { filter, gain }
    }
    const now = context.currentTime
    this.plunger.filter.frequency.setTargetAtTime(650 + this.charge * 1700, now, 0.04)
    this.plunger.gain.gain.setTargetAtTime(active ? 0.012 + this.charge * 0.03 : 0, now, 0.03)
  }

  /** Briefly pull the music down so a stinger can speak. */
  duck(): void {
    const context = this.context
    const gain = this.musicDuck?.gain
    if (!context || !gain) return
    const now = context.currentTime
    const current = gain.value
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(current, now)
    gain.setTargetAtTime(0.3, now, 0.01)
    gain.setTargetAtTime(1, now + 0.9, 0.12)
  }

  play(type: string, opts: SoundOptions = {}): void {
    const context = this.context
    if (!context || !this.sfx || this.muted || !this.audible(context)) return
    if (this.voices >= VOICE_CAP && !PRIORITY.has(type)) return
    const now = context.currentTime
    // A real machine never hits twice at exactly the same strength.
    const vol = clamp(opts.intensity ?? 1, 0.3, 1.3) * (0.92 + Math.random() * 0.16)
    let node: AudioNode = this.sfx
    let panner: StereoPannerNode | null = null
    if (typeof opts.x === 'number' && Number.isFinite(opts.x)) {
      panner = context.createStereoPanner()
      panner.pan.value = clamp(opts.x / 3.2, -1, 1) * 0.75
      panner.connect(this.sfx)
      node = panner
    }
    const out: Out = { node, pitch: 1 + (Math.random() * 2 - 1) * 0.025, vol, music: false }
    if (DUCKING.has(type)) this.duck()
    this.voice(type, now, out)
    if (panner) {
      const toDisconnect = panner
      setTimeout(() => toDisconnect.disconnect(), 3000)
    }
  }

  private voice(type: string, now: number, out: Out): void {
    switch (type) {
      case 'flipperUp': {
        // Coil plunger slams into its stop (steel-on-steel clack), the crank drives the bat into its
        // stop and the playfield thumps, then the linkage rattles and the EOS switch opens.
        const v = this.sequence++ % 4
        this.click(now, out, 0.34, 3300, 0.8, 0.007, 'highpass')
        this.thud(116 + v * 3, 0.12, 0.34, now, out)
        this.click(now + 0.001, out, 0.16, 860, 1.3, 0.028)
        this.impactMode(680 + v * 22, 0.045, 0.05, now, out, 7)
        this.impactMode(1740 + v * 37, 0.035, 0.035, now, out, 5)
        this.click(now + 0.011 + v * 0.002, out, 0.07, 2500, 2, 0.008)
        this.click(now + 0.024, out, 0.03, 5200, 1, 0.004, 'highpass')
        break
      }
      case 'flipperDown':
        // The return spring snaps the bat back onto its rubber stop: a softer, lower clunk and a spring tink.
        this.thud(90, 0.085, 0.2, now, out)
        this.click(now, out, 0.12, 1250, 1.2, 0.014)
        this.impactMode(530, 0.035, 0.025, now + 0.002, out, 6)
        this.impactMode(2800, 0.018, 0.009, now + 0.004, out, 4)
        this.click(now + 0.009, out, 0.03, 3100, 2, 0.005)
        break
      case 'flipper': // ball contact: steel ball on a rubber-ringed bat, a damped thock
        this.click(now, out, 0.18, 2300, 0.7, 0.006, 'lowpass')
        this.thud(205, 0.055, 0.14, now, out)
        this.impactMode(940, 0.025, 0.02, now, out, 5)
        break
      case 'wall': {
        // Wood wall or steel guide: a bright tick, a short metallic ring, and a little body.
        const v = this.sequence++ % 3
        this.click(now, out, 0.14, 3600, 0.9, 0.005, 'highpass')
        this.impactMode([1180, 1320, 1080][v], 0.035, 0.035, now, out, 8)
        this.impactMode([2860, 3140, 2580][v], 0.02, 0.016, now, out, 5)
        this.thud(240, 0.04, 0.07, now, out)
        break
      }
      case 'bumper': {
        // Pop bumper: the coil yanks the ring down onto the ball. Sharp metallic snap, a big cabinet
        // thwock, then the skirt and switch rattling back.
        const v = this.sequence++ % 3
        this.click(now, out, 0.38, 2800, 0.7, 0.009, 'highpass')
        this.thud([96, 104, 90][v], 0.17, 0.36, now, out)
        this.click(now, out, 0.2, 620, 1.1, 0.03)
        this.impactMode([480, 535, 440][v], 0.075, 0.07, now + 0.001, out, 5)
        this.impactMode([1120, 1260, 1010][v], 0.048, 0.045, now + 0.001, out, 9)
        this.impactMode([2380, 2570, 2180][v], 0.027, 0.022, now + 0.001, out, 6)
        this.click(now + 0.014, out, 0.06, 3900, 2, 0.006)
        break
      }
      case 'sling':
        // Slingshot: the kicker arm whacks the rubber (thump), its coil clacks, and the rubber snaps.
        this.thud(132, 0.13, 0.3, now, out)
        this.click(now, out, 0.28, 2400, 0.8, 0.008, 'highpass')
        this.click(now, out, 0.16, 480, 1, 0.035)
        this.impactMode(610, 0.055, 0.055, now + 0.001, out, 5)
        this.impactMode(1480, 0.032, 0.03, now + 0.001, out, 7)
        this.click(now + 0.017, out, 0.07, 3100, 1.6, 0.006)
        break
      case 'launch':
        // The plunger lets go: rod knob slams the housing, the spring twangs, and the ball rips up the shooter lane.
        this.click(now, out, 0.32, 3000, 0.7, 0.01, 'highpass')
        this.thud(74, 0.2, 0.3, now, out)
        this.impactMode(310, 0.12, 0.065, now, out, 4)
        this.impactMode(870, 0.075, 0.04, now, out, 7)
        this.impactMode(1940, 0.042, 0.025, now, out, 5)
        this.impactMode(430, 0.16, 0.02, now + 0.004, out, 7)
        this.noise(0.42, 0.075, 520, now + 0.02, out, 'bandpass', 1.2, 1700, 0.03)
        this.noise(0.42, 0.06, 240, now + 0.02, out, 'lowpass', 0.7, 460, 0.03)
        break
      case 'target':
        // Standup target: the ball smacks the plastic face and the leaf switch closes behind it.
        this.click(now, out, 0.22, 1900, 0.9, 0.008)
        this.thud(260, 0.05, 0.1, now, out)
        this.impactMode(1480, 0.025, 0.022, now, out, 6)
        this.click(now + 0.008, out, 0.06, 5200, 1, 0.004, 'highpass')
        break
      case 'drain':
        // Ball drops off the apron into the trough: a metal clunk, a few bounces, then it rolls to rest.
        this.click(now, out, 0.22, 1500, 0.9, 0.012)
        this.thud(150, 0.15, 0.22, now, out)
        this.impactMode(390, 0.1, 0.045, now, out, 5)
        this.impactMode(1280, 0.045, 0.022, now, out, 7)
        ;[0.05, 0.085, 0.11].forEach((t, i) => {
          this.click(now + t, out, 0.08 / (i + 1), 2400, 1.4, 0.006)
          this.thud(170, 0.04, 0.06 / (i + 1), now + t, out)
        })
        this.noise(0.34, 0.06, 420, now + 0.06, out, 'lowpass', 0.8, 180, 0.02)
        break
      case 'drainBall': // an extra multiball ball draining: the same drop, lighter
        this.click(now, out, 0.14, 1700, 0.9, 0.01)
        this.thud(160, 0.1, 0.12, now, out)
        this.ring(910, 0.08, 0.025, now, out, 'triangle')
        this.noise(0.22, 0.04, 400, now + 0.04, out, 'lowpass', 0.8, 180, 0.02)
        break
      case 'nudge':
        // Shoving the cabinet: the whole box thumps, the legs scuff, and loose parts rattle.
        this.thud(56, 0.24, 0.34, now, out)
        this.noise(0.13, 0.12, 300, now, out, 'lowpass', 0.7, 140, 0.004)
        ;[0.018, 0.04, 0.063].forEach((t, i) => this.click(now + t, out, 0.05 / (i + 1), 2900 + i * 500, 2, 0.005))
        break
      case 'tilt':
        // The plumb bob swings into its ring, then the tilt buzzer.
        this.ring(2380, 0.3, 0.045, now, out)
        this.ring(5870, 0.12, 0.014, now, out)
        this.tone(92, 82, 0.5, 0.09, 'sawtooth', now + 0.06, out)
        this.tone(97, 86, 0.5, 0.06, 'sawtooth', now + 0.06, out)
        break
      case 'ramp':
        // Entry clack, then a hollow plastic roll climbing the ramp.
        this.click(now, out, 0.14, 2000, 1, 0.007)
        this.thud(300, 0.05, 0.07, now, out)
        this.noise(0.45, 0.065, 620, now, out, 'bandpass', 3, 1150, 0.03)
        this.noise(0.45, 0.035, 1500, now, out, 'bandpass', 4, 2600, 0.03)
        break
      case 'tube':
        // Wire-form ramp: the ball skitters along the steel wires.
        for (let i = 0; i < 9; i++) this.ring(2600 + Math.random() * 900, 0.03, 0.022 * (1 - i / 12), now + i * 0.032 + Math.random() * 0.01, out)
        this.noise(0.32, 0.03, 3200, now, out, 'bandpass', 2, 2400, 0.02)
        break
      case 'chamber':
        // Ball drops into a metal saucer: a hollow clunk and a ring from the cup.
        this.thud(105, 0.18, 0.28, now, out)
        this.click(now, out, 0.18, 1200, 1, 0.015)
        this.impactMode(420, 0.12, 0.055, now + 0.002, out, 5)
        this.impactMode(1180, 0.065, 0.03, now + 0.002, out, 8)
        this.impactMode(2460, 0.035, 0.014, now + 0.002, out, 6)
        break
      case 'wormhole':
        this.tone(980, 110, 0.55, 0.1, 'sine', now, out)
        this.tone(490, 60, 0.55, 0.06, 'triangle', now + 0.03, out)
        break
      case 'kickout':
      case 'kicker':
        // Saucer kicker: KA-CHUNK from the coil, then the ball clipping the saucer lip on its way out.
        this.kick(now, out)
        this.click(now + 0.03, out, 0.06, 1800, 1.5, 0.008)
        break
      case 'rollover':
        // Rollover wire flicks its switch: a tiny steel tick.
        this.click(now, out, 0.08, 4800, 1, 0.004, 'highpass')
        this.impactMode(2860, 0.018, 0.014, now, out, 7)
        this.click(now + 0.006, out, 0.035, 2100, 2, 0.004)
        break
      case 'drop':
        // Ball smacks the target, which falls into its bank with a plastic rattle.
        this.click(now, out, 0.22, 2100, 0.9, 0.008)
        this.thud(230, 0.06, 0.13, now, out)
        this.click(now + 0.022, out, 0.11, 1100, 1.2, 0.03)
        this.impactMode(940, 0.04, 0.025, now + 0.022, out, 6)
        this.click(now + 0.05, out, 0.045, 2800, 2, 0.006)
        break
      case 'spinner':
        // One flag revolution flicking past its switch.
        this.click(now, out, 0.07, 4200, 1.2, 0.004, 'highpass')
        this.impactMode(2380, 0.018, 0.014, now, out, 5)
        break
      case 'hyperspace':
        this.tone(220, 1760, 0.6, 0.08, 'sawtooth', now, out)
        this.tone(110, 880, 0.6, 0.06, 'sine', now, out)
        break
      case 'eruption': // deep ground rumble, then a rising blast
        this.tone(70, 28, 1.2, 0.26, 'sine', now, out)
        this.noise(1.1, 0.14, 380, now, out)
        this.tone(140, 980, 0.7, 0.07, 'sawtooth', now + 0.18, out)
        this.noise(0.5, 0.05, 5000, now + 0.25, out, 'highpass', 0.7)
        break
      case 'mission':
      case 'expedition':
      case 'bonus':
        ;[659.25, 880].forEach((frequency, index) => this.chime(frequency, 0.09, now + index * 0.11, out))
        break
      case 'rank':
        ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => this.chime(frequency, 0.09, now + index * 0.12, out))
        this.formant(196, 175, 0.55, 0.1, now + 0.3, out, [730, 570], [1090, 840])
        break
      case 'multiball':
        // The trough kicks out the extra balls, then the stinger.
        this.kick(now, out)
        this.kick(now + 0.16, out)
        this.tone(55, 28, 0.9, 0.2, 'sine', now, out)
        this.tone(220, 880, 0.7, 0.06, 'sawtooth', now + 0.05, out)
        this.tone(330, 1320, 0.7, 0.045, 'triangle', now + 0.1, out)
        ;[440, 554.37, 659.25, 880].forEach((frequency, index) => this.chime(frequency, 0.07, now + 0.45 + index * 0.08, out))
        this.formant(130, 110, 0.75, 0.12, now + 0.2, out, [730, 570], [1090, 840])
        break
      case 'jackpot':
        // The replay knocker, then a run up the chime box.
        this.knocker(now, out)
        ;[783.99, 987.77, 1174.66, 1567.98, 1975.53].forEach((frequency, index) => this.chime(frequency, 0.075, now + 0.08 + index * 0.075, out))
        this.noise(0.7, 0.035, 6500, now + 0.38, out, 'highpass', 0.7)
        break
      case 'bonusTick': {
        // Bonus countdown: a relay clicks over and taps one of two short chimes.
        const high = this.tickSequence++ % 2 === 1
        const frequency = high ? 1318.51 : 1046.5
        this.click(now, out, 0.07, 2600, 1.6, 0.005)
        this.ring(frequency, 0.22, 0.045, now, out, 'sine', 0)
        this.ring(frequency * 2.756, 0.08, 0.012, now, out, 'sine', 0)
        break
      }
      case 'gameover':
        ;[523.25, 440, 349.23, 261.63].forEach((frequency, index) => this.chime(frequency, 0.09, now + index * 0.18, out))
        this.thud(62, 0.9, 0.16, now + 0.55, out)
        break
    }
  }

  // ---- Mechanical primitives ---------------------------------------------------------------

  /** A contact: a few milliseconds of filtered noise. */
  private click(when: number, out: Out, volume: number, frequency: number, q = 1, duration = 0.006, filter: BiquadFilterType = 'bandpass'): void {
    this.noise(duration, volume, frequency, when, out, filter, q, frequency, 0.0003)
  }

  /** A struck mode (steel, plastic): fixed pitch with a hair of droop, instant attack, exponential ring-out. */
  private ring(frequency: number, decay: number, volume: number, when: number, out: Out, type: OscillatorType = 'sine', spread = 0.012): void {
    const pitch = frequency * (1 + (Math.random() * 2 - 1) * spread)
    this.tone(pitch, pitch * 0.992, decay, volume, type, when, out, 0.0005)
  }

  /** Wood and coils: a soft low-frequency impact that drives several inharmonic body modes. */
  private thud(frequency: number, decay: number, volume: number, when: number, out: Out): void {
    this.noise(decay, volume * 0.55, frequency * 5, when, out, 'lowpass', 0.65, frequency * 1.8, 0.0005)
    this.impactMode(frequency * 1.12, decay * 0.8, volume * 0.3, when, out, 2.2)
    this.impactMode(frequency * 2.73, decay * 0.42, volume * 0.12, when + 0.001, out, 3.5)
  }

  /** Struck chime bar, as in an electromechanical chime box: free-bar partials, long fundamental. */
  private chime(frequency: number, volume: number, when: number, out: Out): void {
    this.click(when, out, volume * 0.6, 3800, 1, 0.004, 'highpass')
    this.ring(frequency, 1.2, volume, when, out, 'sine', 0)
    this.ring(frequency * 2.756, 0.5, volume * 0.35, when, out, 'sine', 0)
    this.ring(frequency * 5.404, 0.2, volume * 0.13, when, out, 'sine', 0)
  }

  /** A saucer/trough kicker coil firing. */
  private kick(when: number, out: Out): void {
    this.thud(88, 0.16, 0.32, when, out)
    this.click(when, out, 0.3, 2600, 0.7, 0.01, 'highpass')
    this.click(when, out, 0.16, 520, 1, 0.04)
    this.ring(1240, 0.065, 0.05, when, out, 'triangle')
    this.ring(2290, 0.04, 0.026, when, out)
  }

  /**
   * A noise impulse exciting a narrow, inharmonic part resonance. Real ball and mechanism impacts
   * have unstable, slightly gritty modes; pure oscillator rings make them sound like UI beeps.
   */
  private impactMode(frequency: number, decay: number, volume: number, when: number, out: Out, q = 6): void {
    const context = this.context
    const buffer = this.noiseBuffer
    if (!context || !buffer || (!out.music && this.voices >= HARD_VOICE_CAP)) return
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    const pitch = out.pitch * (1 + (Math.random() * 2 - 1) * 0.018)
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.Q.value = q
    filter.frequency.setValueAtTime(Math.max(25, frequency * pitch * 1.025), when)
    filter.frequency.exponentialRampToValueAtTime(Math.max(25, frequency * pitch * 0.985), when + Math.min(0.025, decay * 0.55))
    gain.gain.setValueAtTime(Math.max(0.0001, volume * out.vol), when)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.008, decay))
    source.connect(filter)
    filter.connect(gain)
    gain.connect(out.node)
    if (!out.music) this.voices++
    source.start(when, Math.random() * Math.max(0, buffer.duration - decay - 0.05))
    source.stop(when + decay)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      if (!out.music && this.context === context) this.voices--
    }
  }

  /** The replay knocker: a coil hammer whacking the inside of the cabinet. */
  private knocker(when: number, out: Out): void {
    this.thud(78, 0.26, 0.42, when, out)
    this.click(when, out, 0.4, 1800, 0.6, 0.02)
    this.click(when, out, 0.26, 3500, 0.7, 0.01, 'highpass')
    this.ring(410, 0.13, 0.055, when, out, 'triangle')
  }

  /** `glide` is how long the pitch takes to move from `from` to `to`; it then holds. */
  private tone(from: number, to: number, duration: number, volume: number, type: OscillatorType, when: number, out: Out, attack = 0.004, glide = duration): void {
    const context = this.context
    if (!context || (!out.music && this.voices >= HARD_VOICE_CAP)) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(from * out.pitch, when)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to * out.pitch), when + Math.min(glide, duration))
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * out.vol), when + Math.min(attack, duration * 0.5))
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    oscillator.connect(gain)
    gain.connect(out.node)
    if (!out.music) this.voices++
    oscillator.start(when)
    oscillator.stop(when + duration + 0.02)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      if (!out.music && this.context === context) this.voices--
    }
  }

  private noise(
    duration: number,
    volume: number,
    frequency: number,
    when: number,
    out: Out,
    filterType: BiquadFilterType = 'lowpass',
    q = 0.7,
    endFrequency = frequency,
    attack = 0.001,
  ): void {
    const context = this.context
    const buffer = this.noiseBuffer
    if (!context || !buffer || (!out.music && this.voices >= HARD_VOICE_CAP)) return
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = filterType
    filter.frequency.setValueAtTime(Math.max(20, frequency * out.pitch), when)
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency * out.pitch), when + duration)
    filter.Q.value = q
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * out.vol), when + Math.min(attack, duration * 0.5))
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(out.node)
    if (!out.music) this.voices++
    source.start(when, Math.random() * Math.max(0, buffer.duration - duration - 0.05))
    source.stop(when + duration)
    source.onended = () => {
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      if (!out.music && this.context === context) this.voices--
    }
  }

  /** Voice-like stinger: a sawtooth through two gliding band-pass formants. */
  private formant(f0: number, f0End: number, duration: number, volume: number, when: number, out: Out, f1: [number, number], f2: [number, number]): void {
    const context = this.context
    if (!context || this.voices >= HARD_VOICE_CAP) return
    const osc = context.createOscillator()
    const env = context.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(f0 * out.pitch, when)
    osc.frequency.exponentialRampToValueAtTime(f0End * out.pitch, when + duration)
    env.gain.setValueAtTime(0.0001, when)
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * out.vol), when + 0.06)
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    const filters = [f1, f2].map(([from, to], index) => {
      const filter = context.createBiquadFilter()
      const level = context.createGain()
      filter.type = 'bandpass'
      filter.Q.value = 7
      filter.frequency.setValueAtTime(from, when)
      filter.frequency.exponentialRampToValueAtTime(to, when + duration * 0.9)
      level.gain.value = index === 0 ? 2.4 : 1.5
      osc.connect(filter)
      filter.connect(level)
      level.connect(env)
      return { filter, level }
    })
    env.connect(out.node)
    this.voices++
    osc.start(when)
    osc.stop(when + duration + 0.02)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
      filters.forEach(({ filter, level }) => { filter.disconnect(); level.disconnect() })
      if (this.context === context) this.voices--
    }
  }

  // ---- Music -------------------------------------------------------------------------------

  startMusic(table: MusicTable): void {
    this.wantedMusic = table
    const context = this.context
    if (!context || !this.musicDuck) return
    if (this.musicTimer && this.musicTable === table) return
    this.teardownMusic(0.25)
    const hi = context.createGain()
    const low = context.createBiquadFilter()
    const tone = context.createBiquadFilter()
    const fade = context.createGain()
    low.type = 'lowpass'
    low.frequency.value = table === 'orbital' ? 1800 : table === 'cadet' ? 700 : 480
    tone.type = 'lowpass'
    tone.frequency.value = table === 'orbital' ? 1800 : table === 'cadet' ? 6000 : 3800
    hi.connect(tone)
    low.connect(tone)
    tone.connect(fade)
    fade.connect(this.musicDuck)
    fade.gain.setValueAtTime(0, context.currentTime)
    fade.gain.linearRampToValueAtTime(1, context.currentTime + 1)
    this.chain = { hi, low, tone, fade }
    this.musicTable = table
    this.musicStep = 0
    this.nextNoteTime = context.currentTime + 0.1
    this.scheduleMusic()
    this.musicTimer = setInterval(() => this.scheduleMusic(), 60)
  }

  stopMusic(): void {
    this.wantedMusic = null
    this.teardownMusic(0.4)
  }

  private teardownMusic(fadeSeconds: number): void {
    if (this.musicTimer) clearInterval(this.musicTimer)
    this.musicTimer = null
    this.musicTable = null
    const chain = this.chain
    this.chain = null
    const context = this.context
    if (!chain || !context) return
    chain.fade.gain.cancelScheduledValues(context.currentTime)
    chain.fade.gain.setTargetAtTime(0, context.currentTime, fadeSeconds / 4)
    setTimeout(() => { chain.fade.disconnect(); chain.tone.disconnect(); chain.low.disconnect(); chain.hi.disconnect() }, fadeSeconds * 1000 + 300)
  }

  private scheduleMusic(): void {
    const context = this.context
    if (!context || !this.musicTable || !this.chain) return
    if (this.nextNoteTime < context.currentTime - 0.1) this.nextNoteTime = context.currentTime + 0.05
    const horizon = context.currentTime + 0.25
    const stepDuration = STEP_SECONDS[this.musicTable]
    while (this.nextNoteTime < horizon) {
      if (this.musicTable === 'orbital') this.orbitalStep(this.musicStep, this.nextNoteTime)
      else if (this.musicTable === 'cadet') this.cadetStep(this.musicStep, this.nextNoteTime)
      else this.volcanoStep(this.musicStep, this.nextNoteTime)
      this.nextNoteTime += stepDuration
      this.musicStep++
    }
  }

  private orbitalStep(step: number, when: number): void {
    const chain = this.chain
    if (!chain) return
    const hi: Out = { node: chain.hi, pitch: 1, vol: 1, music: true }
    const low: Out = { node: chain.low, pitch: 1, vol: 1, music: true }
    const chord = ORBITAL_CHORDS[Math.floor(step / 8) % ORBITAL_CHORDS.length]
    const s = step % 8
    if (s === 0) {
      this.tone(chord.bass, chord.bass, ORBITAL_STEP * 7.5, 0.17, 'sine', when, low, 0.06)
      this.tone(chord.tones[0], chord.tones[0], ORBITAL_STEP * 8, 0.02, 'sine', when, hi, 0.7)
      this.tone(chord.tones[2], chord.tones[2], ORBITAL_STEP * 8, 0.016, 'sine', when, hi, 0.9)
    } else if (s === 4) {
      this.tone(chord.bass * 2, chord.bass * 2, ORBITAL_STEP * 3, 0.07, 'sine', when, low, 0.04)
    }
    const r = hash01(step)
    if (s !== 0 && r < 0.42) {
      const note = chord.tones[Math.floor(hash01(step + 977) * chord.tones.length)]
      this.tone(note, note, 0.9, 0.05, 'triangle', when, hi, 0.01)
      this.tone(note, note, 0.8, 0.02, 'triangle', when + ORBITAL_STEP * 0.75, hi, 0.01)
    }
  }

  private cadetStep(step: number, when: number): void {
    const chain = this.chain
    if (!chain) return
    const hi: Out = { node: chain.hi, pitch: 1, vol: 1, music: true }
    const low: Out = { node: chain.low, pitch: 1, vol: 1, music: true }
    const chord = CADET_CHORDS[Math.floor(step / 8) % CADET_CHORDS.length]
    const s = step % 8
    if (s !== 1 && s !== 5) {
      const bass = s === 3 || s === 6 ? chord.bass * 2 : chord.bass
      this.tone(bass, bass, CADET_STEP * 0.85, 0.11, 'sawtooth', when, low, 0.01)
    }
    const arp = chord.tones[CADET_ARP[s]]
    this.tone(arp, arp, CADET_STEP * 1.4, 0.04, 'triangle', when, hi, 0.008)
    if (s % 2 === 1) this.noise(0.03, 0.02, 7000, when, hi, 'highpass', 0.7)
  }

  /** Slow, heavy groove: tom booms, a growling bass, and bubbling lava arpeggios. */
  private volcanoStep(step: number, when: number): void {
    const chain = this.chain
    if (!chain) return
    const hi: Out = { node: chain.hi, pitch: 1, vol: 1, music: true }
    const low: Out = { node: chain.low, pitch: 1, vol: 1, music: true }
    const chord = VOLCANO_CHORDS[Math.floor(step / 8) % VOLCANO_CHORDS.length]
    const s = step % 8
    if (s === 0 || s === 3 || s === 6) this.tone(120, 42, 0.32, 0.2, 'sine', when, low, 0.004)
    if (s === 0) this.noise(VOLCANO_STEP * 6, 0.035, 220, when, low)
    if (s !== 2 && s !== 7) {
      const bass = s === 5 ? chord.bass * 1.5 : chord.bass
      this.tone(bass, bass * 0.98, VOLCANO_STEP * 0.9, 0.1, 'sawtooth', when, low, 0.008)
    }
    if (hash01(step) < 0.55) {
      const note = chord.tones[Math.floor(hash01(step + 311) * chord.tones.length)]
      this.tone(note, note * 1.02, VOLCANO_STEP * 1.6, 0.035, 'triangle', when, hi, 0.006)
    }
    if (s === 4) this.noise(0.05, 0.03, 2600, when, hi, 'highpass', 0.6)
  }

  dispose(): void {
    this.teardownMusic(0.05)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
    this.master = null
    this.sfx = null
    this.cabinet = null
    this.noiseBuffer = null
    this.musicBus = null
    this.musicDuck = null
    this.musicPause = null
    this.roll = null
    this.rollState = { speed: -1, x: 0 }
    this.plunger = null
    this.charge = 0
    this.chargeNotch = 0
    this.voices = 0
  }
}
