/** The contract every playable table exposes to the app shell. */
export type TableStatus = 'ready' | 'playing' | 'paused' | 'gameover'

export type TableSnapshot = Readonly<{
  status: TableStatus
  score: number
  best: number
  ballNumber: number
  multiplier: number
  combo: number
  charge: number
  message: string
  launchReady: boolean
  hits: number
  ballSave: boolean
  tilted: boolean
}>

export interface TableGame {
  getSnapshot: () => TableSnapshot
  subscribe: (listener: () => void) => () => void
  setFlipper(side: 'left' | 'right', pressed: boolean): void
  startCharge(): void
  cancelCharge(): void
  releaseCharge(): void
  togglePause(): void
  newGame(): void
  nudge(): void
}

export type BoardId = 'orbital' | 'cadet' | 'volcano'
