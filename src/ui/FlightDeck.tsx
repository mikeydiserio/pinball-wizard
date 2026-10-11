import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, Crosshair, Play, Trophy } from '@phosphor-icons/react'
import { BALLS_PER_GAME, PinballGame } from '../game/physics'
import { MISSIONS, RANKS, SpaceCadetGame } from '../boards/spaceCadet/game'
import type { CadetSnapshot } from '../boards/spaceCadet/game'
import { EXPEDITIONS, RANKS as VOLCANO_RANKS, VolcanoGame } from '../boards/volcano/game'
import type { VolcanoSnapshot } from '../boards/volcano/game'
import type { BoardId, TableGame } from '../game/table'
import type { PinballAudio } from '../game/audio'

export const TABLE_NAMES = { orbital: 'ORBITAL', cadet: 'SPACE CADET', volcano: 'ERUPTION' } as const
/** Rank ladders for the tables that have one. */
const RANK_NAMES: Partial<Record<BoardId, readonly string[]>> = { cadet: RANKS, volcano: VOLCANO_RANKS }
const SAVE_LABELS: Record<BoardId, string> = { orbital: 'BALL SAVE', cadet: 'AUTO REPLAY', volcano: 'LAVA SHIELD' }
const formatScore = (value: number) => Math.floor(value).toString().padStart(7, '0')
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function AnimatedScore({ score }: { score: number }) {
  const [display, setDisplay] = useState(score)
  const current = useRef(score)
  useEffect(() => {
    if (score <= current.current || reducedMotion()) { current.current = score; setDisplay(score); return }
    const from = current.current
    const duration = Math.min(900, 200 + (score - from) * .02)
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      current.current = Math.round(from + (score - from) * (1 - Math.pow(1 - progress, 3)))
      setDisplay(current.current)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [score])
  return <><span aria-hidden="true">{formatScore(display)}</span><span className="sr-only">{score.toLocaleString()} points</span></>
}

export function ScoreHud({ game, board }: { game: TableGame; board: BoardId }) {
  const snapshot = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const multiball = board === 'cadet' && (snapshot as CadetSnapshot).multiball
  return <section className="score-readout" aria-label="Score and table status">
    <div className="section-label">YOUR SCORE <span className="player-label">P1</span></div>
    <div className="score-value" aria-live="off"><AnimatedScore score={snapshot.score} /></div>
    <div className="high-score"><Trophy size={15} /><span>PERSONAL BEST</span><strong>{formatScore(snapshot.best)}</strong></div>
    <div className={`dmd ${snapshot.tilted ? 'dmd-tilt' : ''}`} role="status" aria-live="polite" aria-atomic="true"><span key={snapshot.message} className="dmd-line">{snapshot.message}</span></div>
    <div className="status-chips">
      <span aria-label={`Ball ${snapshot.ballNumber} of ${BALLS_PER_GAME}`}>BALL {Array.from({ length: BALLS_PER_GAME }, (_, i) => <i key={i} className={i < snapshot.ballNumber ? 'on' : ''} />)}</span>
      <span aria-label={`Multiplier ${snapshot.multiplier}`}>×{snapshot.multiplier}</span>
      {snapshot.combo > 1 && <span>COMBO {snapshot.combo}</span>}
      {snapshot.ballSave && <span className="save-chip">{SAVE_LABELS[board]}</span>}
      {board === 'cadet' && (snapshot as CadetSnapshot).replay && <span className="save-chip">WORMHOLE REPLAY</span>}
      {board === 'volcano' && (snapshot as VolcanoSnapshot).replay && <span className="save-chip">LAVA TUBE REPLAY</span>}
      {multiball && <span className="save-chip">MULTIBALL</span>}
      {snapshot.tilted && <span className="tilt-chip">TILT</span>}
    </div>
  </section>
}

export function MissionPanel({ game, board }: { game: TableGame; board: BoardId }) {
  const snapshot = useSyncExternalStore(game.subscribe, game.getSnapshot)
  if (board === 'cadet') {
    const cadet = snapshot as CadetSnapshot
    const mission = cadet.mission === null ? null : MISSIONS[cadet.mission]
    const selected = cadet.selectedMission === null ? null : MISSIONS[cadet.selectedMission]
    const step = mission?.steps[cadet.missionStage]
    return <section className="mission-panel" aria-label="Flight status">
      <div className="section-label"><Crosshair size={16} /> FLIGHT STATUS</div>
      <div className="mission-item"><span className="mission-number">RK</span><div><strong>{RANKS[cadet.rank]}</strong><div className="rank-pips" aria-label={`Rank ${cadet.rank + 1} of ${RANKS.length}`}>{RANKS.map((rank, i) => <i key={rank} className={i <= cadet.rank ? 'lit' : ''} />)}</div></div></div>
      <div className="mission-item"><span className="mission-number">MS</span><div><strong>{mission ? mission.name : selected?.name ?? 'Awaiting orders'}</strong><p>{step ? `${step.brief}: ${cadet.missionProgress}/${step.goal}` : cadet.missionReady ? 'Shoot the launch ramp to accept.' : 'Hit a mission target to select orders.'}</p>{step && <progress className="mission-progress" aria-label="Mission progress" max={step.goal} value={cadet.missionProgress} />}</div></div>
      <div className="mission-item"><span className="mission-number">HS</span><div><strong>Fuel {cadet.fuel}/6 · Hyperspace {cadet.hyperspace}/4</strong><p>{cadet.extraBalls > 0 ? `${cadet.extraBalls} extra ball${cadet.extraBalls > 1 ? 's' : ''} banked` : `${cadet.rankProgress}/18 progress lights toward promotion.`}</p></div></div>
    </section>
  }
  if (board === 'volcano') {
    const volcano = snapshot as VolcanoSnapshot
    const expedition = volcano.expedition === null ? null : EXPEDITIONS[volcano.expedition]
    const selected = volcano.selectedExpedition === null ? null : EXPEDITIONS[volcano.selectedExpedition]
    const step = expedition?.steps[volcano.expeditionStage]
    return <section className="mission-panel" aria-label="Expedition status">
      <div className="section-label"><Crosshair size={16} /> EXPEDITION LOG</div>
      <div className="mission-item"><span className="mission-number">RK</span><div><strong>{VOLCANO_RANKS[volcano.rank]}</strong><div className="rank-pips" aria-label={`Rank ${volcano.rank + 1} of ${VOLCANO_RANKS.length}`}>{VOLCANO_RANKS.map((rank, i) => <i key={rank} className={i <= volcano.rank ? 'lit' : ''} />)}</div></div></div>
      <div className="mission-item"><span className="mission-number">EX</span><div><strong>{expedition ? expedition.name : selected?.name ?? 'Base camp'}</strong><p>{step ? `${step.brief}: ${volcano.expeditionProgress}/${step.goal}` : volcano.expeditionReady ? 'Climb the rim ramp to set out.' : 'Hit a survey target to plan an expedition.'}</p>{step && <progress className="mission-progress" aria-label="Expedition progress" max={step.goal} value={volcano.expeditionProgress} />}</div></div>
      <div className="mission-item"><span className="mission-number">PR</span><div><strong>Pressure {volcano.pressure}/6 · Eruption {volcano.eruption}/4</strong><p>{volcano.extraBalls > 0 ? `${volcano.extraBalls} extra ball${volcano.extraBalls > 1 ? 's' : ''} banked` : `${volcano.rankProgress}/18 heat lights toward promotion.`}</p></div></div>
    </section>
  }
  const orbital = game as PinballGame
  const lit = orbital.targetLights.filter(Boolean).length
  return <section className="mission-panel" aria-label="Game objectives">
    <div className="section-label"><Crosshair size={16} /> THE MISSION</div>
    <div className="mission-item"><span className="mission-number">01</span><div><strong>{snapshot.hits ? 'Reactor online' : 'Wake the reactor'}</strong><p>{snapshot.hits ? `${snapshot.hits} hits · chain them for a combo` : 'Hit the glowing pop bumpers.'}</p></div></div>
    <div className="mission-item"><span className="mission-number">02</span><div><strong>Build your multiplier</strong><p>{lit}/3 orbit targets lit · {snapshot.multiplier}× scoring</p><div className="orbit-pips" aria-hidden="true">{orbital.targetLights.map((on, i) => <i key={i} className={on ? 'lit' : ''} />)}</div></div></div>
    <div className="mission-item"><span className="mission-number">03</span><div><strong>Stay in orbit</strong><p>Keep it alive. Beat your best.</p></div></div>
  </section>
}

export function LaunchPanel({ game, audio, charging, disabled, onStart, onEnd, onCancel }: {
  game: TableGame; audio: PinballAudio; charging: boolean; disabled: boolean
  onStart: () => void; onEnd: () => void; onCancel: () => void
}) {
  const snapshot = useSyncExternalStore(game.subscribe, game.getSnapshot)
  useEffect(() => { audio.setCharge(charging ? snapshot.charge : 0) }, [audio, charging, snapshot.charge])
  useEffect(() => () => audio.setCharge(0), [audio])
  return <div className="launch-module">
    <div className="launch-label"><span>LAUNCH POWER</span><span>{Math.round(snapshot.charge * 100).toString().padStart(2, '0')}<small>%</small></span></div>
    <div className="power-bars">{Array.from({ length: 24 }, (_, i) => <i key={i} className={snapshot.charge * 24 > i ? 'charged' : ''} />)}</div>
    <button className={`launch-button ${charging ? 'charging' : ''}`} disabled={disabled || !snapshot.launchReady || snapshot.status === 'paused' || snapshot.status === 'gameover'}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); onStart() }} onPointerUp={onEnd} onPointerCancel={onCancel}
      onKeyDown={event => { if ((event.code === 'Enter' || event.code === 'Space') && !event.repeat) { event.preventDefault(); event.stopPropagation(); onStart() } }}
      onKeyUp={event => { if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); event.stopPropagation(); onEnd() } }}
      onBlur={onCancel}
    ><span>{charging ? 'RELEASE TO LAUNCH' : snapshot.status === 'gameover' ? 'GAME OVER' : `LAUNCH BALL ${snapshot.ballNumber} / ${BALLS_PER_GAME}`}</span><ArrowUpRight size={24} /></button>
    <p className="launch-hint">Hold <kbd>SPACE</kbd> to charge. Release to launch.</p>
  </div>
}

export function FlightFeedback({ game, board, panelOpen, charging, onContinue }: {
  game: TableGame; board: BoardId; panelOpen: boolean; charging: boolean; onContinue: () => void
}) {
  const snapshot = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const cadet = board === 'cadet' ? snapshot as CadetSnapshot : null
  const volcano = board === 'volcano' ? snapshot as VolcanoSnapshot : null
  const bonus = cadet?.bonus ?? volcano?.bonus ?? null
  const ranks = RANK_NAMES[board]
  const rank = cadet?.rank ?? volcano?.rank ?? 0
  const initialBest = useRef(snapshot.best)
  const previousBall = useRef(snapshot.ballNumber)
  const [splash, setSplash] = useState<number | null>(null)
  const continueButton = useRef<HTMLButtonElement>(null)
  const over = snapshot.status === 'gameover'
  const paused = snapshot.status === 'paused'
  useEffect(() => {
    if (snapshot.status === 'ready' && snapshot.score === 0) initialBest.current = snapshot.best
  }, [snapshot.status, snapshot.score, snapshot.best])
  useEffect(() => {
    if (snapshot.ballNumber <= previousBall.current) { previousBall.current = snapshot.ballNumber; return }
    previousBall.current = snapshot.ballNumber
    setSplash(snapshot.ballNumber)
    const timer = setTimeout(() => setSplash(null), 1200)
    return () => clearTimeout(timer)
  }, [snapshot.ballNumber])
  useEffect(() => { if (over) continueButton.current?.focus({ preventScroll: true }) }, [over])
  const callout = /\+[\d,]+|COMPLETE|PROMOTED|EXTRA BALL|SKILL|ACCEPTED|STARTED|MULTIBALL|JACKPOT|HYPERSPACE|ERUPTION/.test(snapshot.message)
  return <>
    {snapshot.status === 'ready' && snapshot.ballNumber === 1 && snapshot.score === 0 && !charging && <div className="attract-card"><span>HOLD SPACE TO LAUNCH BALL</span></div>}
    {splash !== null && !over && !paused && <div className="ball-splash" key={splash} aria-live="polite"><span>BACK IN FLIGHT</span><strong>BALL {splash}</strong></div>}
    {callout && !over && !paused && !bonus && <div className="callout-burst" key={snapshot.message} aria-hidden="true">{snapshot.message}</div>}
    {bonus && ranks && !paused && <div className="game-overlay bonus-overlay"><div className="overlay-label">{volcano ? 'ERUPTION BONUS' : 'END OF BALL BONUS'}</div><h2>{ranks[rank]}{cadet ? ` · ×${cadet.bonus!.multiplier}` : ''}</h2><div className="bonus-value">{bonus.count.toLocaleString()}</div><p>of {bonus.total.toLocaleString()} points</p><button className="text-button" onClick={() => (game as SpaceCadetGame | VolcanoGame).skipBonus()}>SKIP COUNT-UP <ArrowUpRight size={16} /></button></div>}
    {paused && !over && !panelOpen && <div className="game-overlay">
      <h2>Game paused</h2>
      <button className="primary-button" onClick={onContinue}>RESUME <Play size={16} weight="fill" /></button>
    </div>}
    {over && <div className="game-overlay">
      <div className="overlay-label">{snapshot.score > initialBest.current ? 'NEW PERSONAL BEST' : 'FLIGHT COMPLETE'}</div>
      <h2>{snapshot.score.toLocaleString()}</h2>
      <p>{`${ranks ? `Final rank: ${ranks[rank]}. ` : ''}Ready for another ${volcano ? 'expedition' : 'flight'}?`}</p>
      <button ref={continueButton} className="primary-button" onClick={onContinue}>PLAY AGAIN <Play size={16} weight="fill" /></button>
    </div>}
  </>
}
