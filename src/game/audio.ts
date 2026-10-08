/**
 * Asset-free sound engine: synthesized sfx, a looping music scheduler, a rolling-ball loop and a
 * plunger whine. The AudioContext is created only on a user gesture (`unlock`).
 *
 * Graph:  voices -> (panner) -> sfx --------------------------\
 *                                  \-> room (convolver) ------+-> master -> compressor -> out
 *         music chain -> fade -> duck -> pauseFilter -> musicBus /
 */
export type MusicTable = 'orbital' | 'cadet'
export interface SoundOptions { x?: number; intensity?: number }

const MASTER = 0.5
const MUSIC_LEVEL = 0.35
const VOICE_CAP = 24
const HARD_VOICE_CAP = 40
const DUCKING = new Set(['mission', 'rank', 'multiball', 'jackpot', 'hyperspace', 'bonus', 'gameover'])
const PRIORITY = new Set([...DUCKING, 'launch', 'drain', 'tilt'])
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const hash01 = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296

/** Where one play() call sends its voices, plus its per-call variation. */
interface Out { node: AudioNode; pitch: number; vol: number; music: boolean }
interface MusicChain { hi: GainNode; low: BiquadFilterNode; tone: BiquadFilterNode; fade: GainNode }

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
const ORBITAL_STEP = 60 / 84 / 2
const CADET_STEP = 60 / 116 / 2

export class PinballAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private sfx: GainNode | null = null
  private room: ConvolverNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private muted = false
  private paused = false
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
  private roll: { filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; source: AudioBufferSourceNode } | null = null
  private rollState = { speed: -1, x: 0 }
  private whine: { osc: OscillatorNode; gain: GainNode } | null = null
  private charge = 0

  unlock(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return
    if (!this.context) {
      try {
        const context = new AudioContext()
        this.context = context
        this.master = context.createGain()
        this.master.gain.value = this.muted ? 0 : MASTER
        const compressor = context.createDynamicsCompressor()
        compressor.threshold.value = -16
        compressor.knee.value = 18
        compressor.ratio.value = 5
        this.master.connect(compressor)
        compressor.connect(context.destination)

        this.sfx = context.createGain()
        this.sfx.connect(this.master)
        this.room = context.createConvolver()
        const impulse = context.createBuffer(2, Math.floor(context.sampleRate * 0.3), context.sampleRate)
        for (let channel = 0; channel < 2; channel++) {
          const data = impulse.getChannelData(channel)
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3) * 0.25
        }
        this.room.buffer = impulse
        this.sfx.connect(this.room)
        this.room.connect(this.master)

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
    this.resumeContext()
    if (this.wantedMusic && !this.musicTimer) this.startMusic(this.wantedMusic)
  }

  private resumeContext(): void {
    const context = this.context
    if (!context) return
    const state = context.state as string
    if (state === 'suspended' || state === 'interrupted') void context.resume().catch(() => undefined)
  }

  private onVisibility = (): void => { if (!document.hidden) this.resumeContext() }

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
    if (paused) {
      this.roll?.gain.gain.setTargetAtTime(0, now, 0.05)
      this.rollState.speed = -1
    }
    this.applyWhine()
  }

  /** World x (about +-3.5) -> pan; speed01 is the ball's normalized speed. Cheap to call every frame. */
  setRoll(speed01: number, x: number): void {
    const context = this.context
    if (!context || context.state !== 'running') return
    const speed = this.paused ? 0 : clamp(speed01, 0, 1)
    const last = this.rollState
    if (Math.abs(speed - last.speed) < 0.01 && Math.abs(x - last.x) < 0.05) return
    if (!this.roll) {
      if (!this.sfx || !this.noiseBuffer) return
      const source = context.createBufferSource()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      const pan = context.createStereoPanner()
      source.buffer = this.noiseBuffer
      source.loop = true
      filter.type = 'bandpass'
      filter.Q.value = 0.9
      gain.gain.value = 0
      source.connect(filter)
      filter.connect(gain)
      gain.connect(pan)
      pan.connect(this.sfx)
      source.start(0, Math.random())
      this.roll = { filter, gain, pan, source }
    }
    last.speed = speed
    last.x = x
    const now = context.currentTime
    this.roll.filter.frequency.setTargetAtTime(300 + speed * 1100, now, 0.05)
    this.roll.gain.gain.setTargetAtTime(Math.pow(speed, 1.5) * 0.05, now, 0.05)
    this.roll.pan.pan.setTargetAtTime(clamp(x / 3.2, -1, 1) * 0.75, now, 0.05)
  }

  /** Plunger tension whine; 0 silences it. */
  setCharge(charge01: number): void {
    this.charge = clamp(charge01, 0, 1)
    this.applyWhine()
  }

  private applyWhine(): void {
    const context = this.context
    if (!context || !this.sfx) return
    const active = this.charge > 0.001 && !this.paused
    if (!this.whine) {
      if (!active) return
      const osc = context.createOscillator()
      const gain = context.createGain()
      const filter = context.createBiquadFilter()
      osc.type = 'sawtooth'
      osc.frequency.value = 100
      filter.type = 'lowpass'
      filter.frequency.value = 1400
      gain.gain.value = 0
      osc.connect(filter)
      filter.connect(gain)
      gain.connect(this.sfx)
      osc.start()
      this.whine = { osc, gain }
    }
    const now = context.currentTime
    this.whine.osc.frequency.setTargetAtTime(100 + this.charge * 380, now, 0.03)
    this.whine.gain.gain.setTargetAtTime(active ? 0.02 : 0, now, 0.03)
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
    if (!context || !this.sfx || context.state !== 'running' || this.muted) return
    if (this.voices >= VOICE_CAP && !PRIORITY.has(type)) return
    const now = context.currentTime
    const vol = clamp(opts.intensity ?? 1, 0.3, 1.3)
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
      case 'bumper': {
        const notes = [329.63, 392, 493.88, 587.33, 659.25]
        const note = notes[this.sequence++ % notes.length]
        this.tone(note, note * 0.985, 0.28, 0.19, 'sine', now, out)
        this.tone(note * 2, note * 2, 0.11, 0.045, 'triangle', now, out)
        this.tone(115, 48, 0.08, 0.22, 'sine', now, out)
        this.noise(0.035, 0.07, 1700, now, out)
        break
      }
      case 'flipperUp':
        this.tone(165, 66, 0.065, 0.1, 'triangle', now, out)
        this.noise(0.035, 0.11, 2400, now, out)
        break
      case 'flipperDown':
        this.tone(120, 60, 0.05, 0.06, 'triangle', now, out)
        break
      case 'flipper': // ball contact: a sharp tick, distinct from the solenoid thunk
        this.tone(560, 280, 0.03, 0.06, 'triangle', now, out)
        this.noise(0.022, 0.1, 2800, now, out, 'bandpass', 1.1)
        break
      case 'wall':
        this.noise(0.04, 0.05, 2000 + Math.random() * 1500, now, out, 'bandpass', 1.4)
        this.tone(900, 620, 0.04, 0.03, 'triangle', now, out)
        break
      case 'sling':
        this.tone(220, 86, 0.11, 0.18, 'triangle', now, out)
        this.noise(0.065, 0.09, 1400, now, out)
        break
      case 'launch':
        this.noise(0.23, 0.15, 3300, now, out)
        this.tone(100, 480, 0.26, 0.12, 'triangle', now, out)
        this.tone(64, 40, 0.16, 0.2, 'sine', now, out)
        break
      case 'target':
        ;[493.88, 659.25, 987.77].forEach((frequency, index) => this.tone(frequency, frequency, 0.18, 0.085, 'sine', now + index * 0.055, out))
        break
      case 'drain':
        this.tone(310, 60, 0.42, 0.13, 'triangle', now, out)
        this.noise(0.15, 0.09, 550, now, out)
        break
      case 'drainBall':
        this.tone(520, 260, 0.18, 0.06, 'sine', now, out)
        break
      case 'nudge':
        this.tone(58, 26, 0.18, 0.24, 'sine', now, out)
        this.noise(0.13, 0.17, 240, now, out)
        break
      case 'tilt':
        this.tone(92, 82, 0.42, 0.1, 'sawtooth', now, out)
        this.tone(97, 86, 0.42, 0.06, 'sawtooth', now, out)
        break
      case 'ramp':
        this.noise(0.4, 0.08, 3000, now, out)
        this.tone(180, 880, 0.4, 0.09, 'triangle', now, out)
        break
      case 'wormhole':
        this.tone(980, 110, 0.55, 0.1, 'sine', now, out)
        this.tone(490, 60, 0.55, 0.06, 'triangle', now + 0.03, out)
        break
      case 'kickout':
      case 'kicker':
        this.tone(150, 55, 0.13, 0.2, 'sine', now, out)
        this.noise(0.07, 0.1, 1600, now, out)
        break
      case 'rollover':
        this.tone(1320, 1240, 0.07, 0.05, 'triangle', now, out)
        break
      case 'drop':
        this.tone(320, 110, 0.11, 0.14, 'square', now, out)
        this.noise(0.05, 0.07, 1800, now, out)
        break
      case 'spinner':
        this.tone(1900, 1750, 0.035, 0.03, 'square', now, out)
        break
      case 'hyperspace':
        this.tone(220, 1760, 0.6, 0.08, 'sawtooth', now, out)
        this.tone(110, 880, 0.6, 0.06, 'sine', now, out)
        break
      case 'mission':
      case 'bonus':
        ;[659.25, 880].forEach((frequency, index) => this.tone(frequency, frequency, 0.16, 0.09, 'triangle', now + index * 0.09, out))
        break
      case 'rank':
        ;[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => this.tone(frequency, frequency, 0.22, 0.1, 'triangle', now + index * 0.12, out))
        this.formant(196, 175, 0.55, 0.1, now + 0.3, out, [730, 570], [1090, 840])
        break
      case 'multiball':
        this.tone(55, 28, 0.9, 0.26, 'sine', now, out)
        this.noise(0.5, 0.1, 900, now, out)
        this.tone(220, 880, 0.7, 0.07, 'sawtooth', now, out)
        this.tone(330, 1320, 0.7, 0.05, 'triangle', now + 0.05, out)
        ;[440, 554.37, 659.25, 880].forEach((frequency, index) => this.tone(frequency, frequency, 0.3, 0.07, 'triangle', now + 0.45 + index * 0.07, out))
        this.formant(130, 110, 0.75, 0.12, now + 0.2, out, [730, 570], [1090, 840])
        break
      case 'jackpot':
        ;[783.99, 987.77, 1174.66, 1567.98, 1975.53].forEach((frequency, index) => {
          this.tone(frequency, frequency, 0.34, 0.075, 'triangle', now + index * 0.07, out)
          this.tone(frequency * 2, frequency * 2, 0.5, 0.02, 'sine', now + index * 0.07 + 0.02, out)
        })
        this.tone(1567.98, 1567.98, 0.9, 0.04, 'sine', now + 0.35, out)
        this.noise(0.7, 0.04, 6500, now + 0.3, out, 'highpass', 0.7)
        break
      case 'bonusTick': {
        const high = this.tickSequence++ % 2 === 1
        this.tone(high ? 1560 : 1320, high ? 1500 : 1270, 0.03, 0.05, 'triangle', now, out)
        break
      }
      case 'gameover':
        ;[523.25, 440, 349.23, 261.63].forEach((frequency, index) => this.tone(frequency, frequency * 0.98, 0.4, 0.09, 'triangle', now + index * 0.16, out))
        this.tone(65.41, 40, 0.9, 0.14, 'sine', now + 0.3, out)
        break
    }
  }

  private tone(from: number, to: number, duration: number, volume: number, type: OscillatorType, when: number, out: Out, attack = 0.004): void {
    const context = this.context
    if (!context || (!out.music && this.voices >= HARD_VOICE_CAP)) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(from * out.pitch, when)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to * out.pitch), when + duration)
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

  private noise(duration: number, volume: number, frequency: number, when: number, out: Out, filterType: BiquadFilterType = 'lowpass', q = 0.7): void {
    const context = this.context
    const buffer = this.noiseBuffer
    if (!context || !buffer || (!out.music && this.voices >= HARD_VOICE_CAP)) return
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = filterType
    filter.frequency.value = frequency * out.pitch
    filter.Q.value = q
    gain.gain.setValueAtTime(Math.max(0.0002, volume * out.vol), when)
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
    low.frequency.value = table === 'orbital' ? 1800 : 700
    tone.type = 'lowpass'
    tone.frequency.value = table === 'orbital' ? 1800 : 6000
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
    const stepDuration = this.musicTable === 'orbital' ? ORBITAL_STEP : CADET_STEP
    while (this.nextNoteTime < horizon) {
      if (this.musicTable === 'orbital') this.orbitalStep(this.musicStep, this.nextNoteTime)
      else this.cadetStep(this.musicStep, this.nextNoteTime)
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

  dispose(): void {
    this.teardownMusic(0.05)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
    this.master = null
    this.sfx = null
    this.room = null
    this.noiseBuffer = null
    this.musicBus = null
    this.musicDuck = null
    this.musicPause = null
    this.roll = null
    this.rollState = { speed: -1, x: 0 }
    this.whine = null
    this.voices = 0
  }
}
