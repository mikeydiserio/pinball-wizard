import { Component, Suspense, lazy, memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CaretRight, Check, Crosshair, GearSix, Pause, Planet, Play, X } from '@phosphor-icons/react'
import { PinballGame } from './game/physics'
import { PinballAudio } from './game/audio'
import type { BoardId, TableGame } from './game/table'
import { SpaceCadetGame } from './boards/spaceCadet/game'
import { FlightFeedback, LaunchPanel, MissionPanel, ScoreHud, TABLE_NAMES } from './ui/FlightDeck'

const GameScene = lazy(() => import('./components/GameScene').then(module => ({ default: module.GameScene })))
const SpaceCadetScene = lazy(() => import('./boards/spaceCadet/SpaceCadetScene').then(module => ({ default: module.SpaceCadetScene })))
const BOARDS: { id: BoardId; name: string }[] = [{ id: 'orbital', name: 'Orbital' }, { id: 'cadet', name: 'Space Cadet' }]
const BOARD_KEY = 'pinball-board'
const storedBoard = (): BoardId => {
  try { return globalThis.localStorage?.getItem(BOARD_KEY) === 'cadet' ? 'cadet' : 'orbital' } catch { return 'orbital' }
}

function preference<T extends string>(key: string, options: readonly T[], fallback: T): T {
  try { const value = localStorage.getItem(`pinball-${key}`); return options.includes(value as T) ? value as T : fallback } catch { return fallback }
}
function persist(key: string, value: string) {
  try { localStorage.setItem(`pinball-${key}`, value) } catch { /* Storage is optional. */ }
}

type Panel = 'help' | 'settings' | null

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError(); console.error('Unable to render the table', error, info) }
  render() {
    if (this.state.failed) return <div className="scene-error"><Planet size={40} /><h2>The table couldn’t start.</h2><p>This game needs WebGL. Enable hardware acceleration in your browser, then reload.</p><button className="primary-button" onClick={() => location.reload()}>Reload game</button></div>
    return this.props.children
  }
}

const TableCanvas = memo(function TableCanvas({ board, games, audio, cameraMode, quality, onReady, onError }: {
  board: BoardId; games: { orbital: PinballGame; cadet: SpaceCadetGame }; audio: PinballAudio
  cameraMode: 'angled' | 'top'; quality: 'high' | 'balanced'; onReady: () => void; onError: () => void
}) {
  return <SceneBoundary key={board} onError={onError}><Suspense fallback={null}>{board === 'cadet'
    ? <SpaceCadetScene game={games.cadet} audio={audio} cameraMode={cameraMode} quality={quality} onReady={onReady} onError={onError} />
    : <GameScene game={games.orbital} audio={audio} cameraMode={cameraMode} quality={quality} onReady={onReady} onError={onError} />}</Suspense></SceneBoundary>
})

export default function App() {
  const [games] = useState(() => ({ orbital: new PinballGame(), cadet: new SpaceCadetGame() }))
  const [board, setBoard] = useState<BoardId>(storedBoard)
  const game: TableGame = games[board]
  const [audio] = useState(() => new PinballAudio())
  const status = useSyncExternalStore(game.subscribe, () => game.getSnapshot().status)
  const [ready, setReady] = useState(false)
  const [sceneFailed, setSceneFailed] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [muted, setMuted] = useState(() => preference('muted', ['0', '1'], '0') === '1')
  const [cameraMode, setCameraMode] = useState<'angled' | 'top'>(() => preference('camera', ['angled', 'top'], 'angled'))
  const [quality, setQuality] = useState<'high' | 'balanced'>(() => preference('quality', ['high', 'balanced'], window.innerWidth < 768 ? 'balanced' : 'high'))
  const [theme, setTheme] = useState<'dark' | 'light'>(() => preference('theme', ['dark', 'light'], 'dark'))
  const [activeKeys, setActiveKeys] = useState({ left: false, right: false, launch: false })
  const modalRef = useRef<HTMLDialogElement>(null)
  const resumeAfterPanel = useRef(false)
  const onReady = useCallback(() => { setSceneFailed(false); setReady(true) }, [])
  const onSceneError = useCallback(() => { setReady(true); setSceneFailed(true) }, [])
  const paused = status === 'paused'
  const gameOver = status === 'gameover'
  const inPlay = status === 'playing'

  const releaseControls = useCallback(() => {
    game.setFlipper('left', false)
    game.setFlipper('right', false)
    game.cancelCharge()
    audio.setCharge(0)
    setActiveKeys({ left: false, right: false, launch: false })
  }, [game, audio])

  const closePanel = useCallback(() => {
    setPanel(null)
    if (resumeAfterPanel.current && game.getSnapshot().status === 'paused') game.togglePause()
    resumeAfterPanel.current = false
  }, [game])

  const openPanel = (next: Panel) => {
    releaseControls()
    resumeAfterPanel.current = ['ready', 'playing'].includes(game.getSnapshot().status)
    if (resumeAfterPanel.current) game.togglePause()
    setPanel(next)
  }

  useEffect(() => {
    if (panel) modalRef.current?.showModal()
    else modalRef.current?.close()
  }, [panel])

  useEffect(() => { audio.setMuted(muted); persist('muted', muted ? '1' : '0') }, [audio, muted])
  useEffect(() => { persist('camera', cameraMode) }, [cameraMode])
  useEffect(() => { persist('quality', quality) }, [quality])
  useEffect(() => { persist('theme', theme) }, [theme])
  useEffect(() => { document.title = `${TABLE_NAMES[board]} · Pinball Club` }, [board])
  useEffect(() => {
    audio.setPaused(paused || sceneFailed)
    if (gameOver || sceneFailed) { audio.stopMusic(); if (!sceneFailed) audio.play('gameover') }
    else audio.startMusic(board)
  }, [audio, board, paused, gameOver, sceneFailed])
  useEffect(() => () => audio.dispose(), [audio])

  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
    const down = (event: KeyboardEvent) => {
      if (panel || sceneFailed || editable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.code
      if ((key === 'Space' || key === 'Enter') && event.target instanceof HTMLElement && event.target.closest('button, a')) return
      if (['ArrowLeft', 'ArrowRight', 'Space', 'ArrowUp', 'KeyA', 'KeyD', 'KeyP', 'Escape', 'KeyN', 'KeyM'].includes(key)) event.preventDefault()
      if (event.repeat) return
      audio.unlock()
      if (board === 'cadet' && games.cadet.getSnapshot().bonus && game.getSnapshot().status !== 'paused' && !['Tab', 'KeyP', 'Escape', 'KeyM', 'ShiftLeft', 'ShiftRight'].includes(key)) { event.preventDefault(); games.cadet.skipBonus(); return }
      if (game.getSnapshot().status === 'gameover' && (key === 'Space' || key === 'Enter')) { event.preventDefault(); game.newGame(); return }
      if (key === 'ArrowLeft' || key === 'KeyA') { game.setFlipper('left', true); if (game.getSnapshot().status !== 'paused' && !game.getSnapshot().tilted) audio.play('flipperUp', { intensity: .65, x: -1.4 }); setActiveKeys(old => ({ ...old, left: true })) }
      if (key === 'ArrowRight' || key === 'KeyD') { game.setFlipper('right', true); if (game.getSnapshot().status !== 'paused' && !game.getSnapshot().tilted) audio.play('flipperUp', { intensity: .65, x: 1.4 }); setActiveKeys(old => ({ ...old, right: true })) }
      if (key === 'Space' && ready && game.getSnapshot().launchReady && game.getSnapshot().status !== 'paused') { game.startCharge(); setActiveKeys(old => ({ ...old, launch: true })) }
      if (key === 'KeyP' || key === 'Escape') { game.togglePause(); releaseControls() }
      if (key === 'ArrowUp' || key === 'KeyN') game.nudge()
      if (key === 'KeyM') setMuted(old => !old)
    }
    const up = (event: KeyboardEvent) => {
      const key = event.code
      if (key === 'ArrowLeft' || key === 'KeyA') { game.setFlipper('left', false); if (!panel && !paused) audio.play('flipperDown', { x: -1.4 }); setActiveKeys(old => ({ ...old, left: false })) }
      if (key === 'ArrowRight' || key === 'KeyD') { game.setFlipper('right', false); if (!panel && !paused) audio.play('flipperDown', { x: 1.4 }); setActiveKeys(old => ({ ...old, right: false })) }
      if (key === 'Space') { if (!panel) game.releaseCharge(); setActiveKeys(old => ({ ...old, launch: false })) }
    }
    const blur = () => { releaseControls(); if (game.getSnapshot().status === 'playing') game.togglePause() }
    const visibility = () => { if (document.hidden) blur() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [audio, game, games, board, panel, ready, sceneFailed, paused, releaseControls])

  const switchBoard = (next: BoardId) => {
    if (next === board) return
    releaseControls()
    games[board].newGame()
    games[next].newGame()
    setReady(false)
    setSceneFailed(false)
    setBoard(next)
    try { globalThis.localStorage?.setItem(BOARD_KEY, next) } catch { /* Storage is optional. */ }
  }

  const beginLaunch = () => { if (!ready || sceneFailed || paused || panel) return; audio.unlock(); if (board === 'cadet' && games.cadet.getSnapshot().bonus) { games.cadet.skipBonus(); return } game.startCharge(); setActiveKeys(old => ({ ...old, launch: true })) }
  const endLaunch = () => { game.releaseCharge(); setActiveKeys(old => ({ ...old, launch: false })) }
  const cancelLaunch = () => { game.cancelCharge(); audio.setCharge(0); setActiveKeys(old => ({ ...old, launch: false })) }
  const flip = (side: 'left' | 'right', pressed: boolean) => {
    audio.unlock()
    if (pressed && board === 'cadet' && games.cadet.getSnapshot().bonus && !paused) { games.cadet.skipBonus(); return }
    game.setFlipper(side, pressed)
    if (!paused && !game.getSnapshot().tilted) audio.play(pressed ? 'flipperUp' : 'flipperDown', { intensity: .65, x: side === 'left' ? -1.4 : 1.4 })
    if (pressed) navigator.vibrate?.(10)
    setActiveKeys(old => ({ ...old, [side]: pressed }))
  }

  return (
    <div className="app" data-theme={theme} data-board={board}>
      <h1 className="sr-only">{TABLE_NAMES[board]} pinball</h1>
      <header className="topbar">
        <a href="#" className="brand" aria-label={`${TABLE_NAMES[board]} home`} onClick={event => event.preventDefault()}><Planet size={33} weight="duotone" /><span>{TABLE_NAMES[board]}</span><span className="brand-category">PINBALL CLUB</span></a>
        <nav className="table-switcher" aria-label="Choose a table"><span className="table-switcher-label">TABLE</span><div className="table-switcher-options">{BOARDS.map(option => <button key={option.id} aria-pressed={option.id === board} onClick={() => switchBoard(option.id)}>{option.name.toUpperCase()}</button>)}</div></nav>
      </header>

      <main className="game-layout">
        <section className="play-area" aria-label="Interactive 3D pinball table">
          <div className="canvas-wrap">
            <TableCanvas board={board} games={games} audio={audio} cameraMode={cameraMode} quality={quality} onReady={onReady} onError={onSceneError} />
            {!ready && <div className="loading-screen"><Planet size={36} /><span>PREPARING THE TABLE</span><span className="loading-track" /></div>}
          </div>
          {ready && !sceneFailed && <FlightFeedback key={board} game={game} board={board} panelOpen={!!panel} charging={activeKeys.launch} onContinue={() => { audio.unlock(); releaseControls(); if (gameOver) game.newGame(); else game.togglePause() }} />}
        </section>

        <aside className="score-panel">
          <ScoreHud key={board} game={game} board={board} />
          <MissionPanel key={`${board}-mission`} game={game} board={board} />
          <LaunchPanel game={game} audio={audio} charging={activeKeys.launch} disabled={!ready || sceneFailed || !!panel} onStart={beginLaunch} onEnd={endLaunch} onCancel={cancelLaunch} />
          <div className="session-controls"><button onClick={() => { audio.unlock(); game.togglePause(); releaseControls() }} disabled={!inPlay && !paused}>{paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Resume' : 'Pause'} <kbd>P</kbd></button><button onClick={() => openPanel('settings')}><GearSix size={15} /> Options</button></div>
        </aside>
      <div className="mobile-controls"><button className={activeKeys.left ? 'pressed' : ''} aria-label="Left flipper" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); flip('left', true) }} onPointerUp={() => flip('left', false)} onPointerCancel={() => flip('left', false)}><ArrowLeft size={23} /><span>LEFT FLIPPER</span></button><button className="mobile-nudge" aria-label="Nudge table" onClick={() => { audio.unlock(); game.nudge() }}><ArrowDown size={19} /><span>NUDGE</span></button><button className={activeKeys.right ? 'pressed' : ''} aria-label="Right flipper" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); flip('right', true) }} onPointerUp={() => flip('right', false)} onPointerCancel={() => flip('right', false)}><span>RIGHT FLIPPER</span><ArrowRight size={23} /></button></div>
      </main>

      <footer className="bottom-bar"><div className="keyboard-guide"><span><kbd className={activeKeys.left ? 'pressed' : ''}>A</kbd><kbd className={activeKeys.right ? 'pressed' : ''}>D</kbd> or <kbd>←</kbd><kbd>→</kbd> <strong>Flippers</strong></span><span><kbd>SPACE</kbd> <strong>Launch</strong></span><span><kbd>N</kbd> <strong>Nudge</strong></span><span><kbd>P</kbd> <strong>Pause</strong></span></div><button className="text-button footer-help" onClick={() => openPanel('help')}>PLAY GUIDE <ArrowUpRight size={14} /></button></footer>

      <dialog ref={modalRef} className="modal" onCancel={event => { event.preventDefault(); closePanel() }} onClick={event => { if (event.target === event.currentTarget) closePanel() }} aria-labelledby="modal-title"><div className="modal-content"><button className="icon-button modal-close" aria-label="Close dialog" onClick={closePanel}><X size={21} /></button><div className="table-label"><Planet size={18} /> {TABLE_NAMES[board]} FLIGHT MANUAL</div><h2 id="modal-title">{panel === 'help' ? 'Find your flow.' : 'Your kind of orbit.'}</h2>{panel === 'help' ? <><p>{board === 'cadet' ? 'Hit a mission target to select orders; hit all three to select the fourth mission. Shoot the launch ramp to accept. Keep six fuel lights supplied and earn 18 progress lights to rise through each rank.' : 'Three balls. One high score. Keep the ball in play, chain reactor hits, and light all three orbit targets to build your multiplier.'}</p><div className="help-rows"><div><span><kbd>←</kbd> <kbd>A</kbd></span><strong>Left flipper</strong></div><div><span><kbd>→</kbd> <kbd>D</kbd></span><strong>Right flipper</strong></div><div><kbd>SPACE</kbd><strong>Hold to charge, release to launch</strong></div><div><kbd>N</kbd><strong>Nudge the table. Too much causes tilt.</strong></div><div><kbd>P</kbd><strong>Pause or resume</strong></div><div><kbd>M</kbd><strong>Toggle sound</strong></div></div><p className="help-tip"><Crosshair size={20} /> Tip: time your flipper press as the ball approaches. Holding a flipper up won’t keep firing it. {board === 'cadet' ? 'Automatic replay lasts 30 seconds after deployment. Open a wormhole and match its exit color to earn another replay. Hyperspace lights extra balls at the out-lanes.' : 'Each drained ball uses one of your three balls.'}</p><p className="touch-note">On a touch screen, use the flipper buttons and hold the orange launch button.</p><button className="primary-button" onClick={closePanel}>LET’S PLAY <CaretRight size={18} /></button></> : <><p>Dial in the table to suit your game.</p><div className="setting-row"><div><strong>Camera</strong><span>Choose your view of the playfield.</span></div><div className="segmented"><button aria-pressed={cameraMode === 'angled'} onClick={() => setCameraMode('angled')}>Angled</button><button aria-pressed={cameraMode === 'top'} onClick={() => setCameraMode('top')}>Overhead</button></div></div><div className="setting-row"><div><strong>Graphics</strong><span>Balanced uses less GPU power.</span></div><div className="segmented"><button aria-pressed={quality === 'high'} onClick={() => setQuality('high')}>High</button><button aria-pressed={quality === 'balanced'} onClick={() => setQuality('balanced')}>Balanced</button></div></div><div className="setting-row"><div><strong>Interface</strong><span>A light or dark surround.</span></div><div className="segmented"><button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</button><button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Light</button></div></div><div className="setting-row"><div><strong>Arcade audio</strong><span>Music and reactive table sounds.</span></div><button className="setting-toggle" aria-pressed={!muted} onClick={() => { audio.unlock(); setMuted(!muted) }}>{muted ? 'Off' : 'On'}{!muted && <Check size={16} />}</button></div><button className="primary-button" onClick={closePanel}>BACK TO THE TABLE <CaretRight size={18} /></button></>}</div></dialog>
    </div>
  )
}
