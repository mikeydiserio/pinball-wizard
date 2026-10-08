# Space Cadet rules test research

- Framework: TypeScript, Vitest 5; colocated `*.test.ts` files. Run `pnpm test`; compile and bundle with `pnpm build`.
- Scope: `src/boards/spaceCadet/game.ts`, `layout.ts`, and the new mission definitions. Existing `game.test.ts` covers physical launch, raised deck, collisions, drains, lanes, and seeded long-running containment.
- Reference: user-provided Space Cadet table/rules excerpt. Rules with contradictory values should follow the documented implementation decision, with explicit tests where the decision affects score.
- Obsolete assertions: generic mission cycle, ramp incrementing hyperspace, automatic center-post ball save, every launch exiting the chute top, hazard drop banks, always-open wormholes, and a 2,500 crash bonus.
- Keep physics integration fixtures local and deterministic; no DOM, network, storage, wall-clock, or renderer dependencies. Public ball coordinates allow targeted collision integration checks.
- Highest-risk changes: replay versus extra-ball lifecycle, multiplied direct scores versus unmultiplied awards, rank-specific multistage mission progress, fuel aborts, independently expiring upgrades, and mutually distinct bank/rollover indices.

