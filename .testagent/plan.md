# Space Cadet rules test plan

1. Update physical regressions after final APIs land: weak-shot bottom exit versus strong-shot top exit; launch deck and bonus-lane return; ground-level elevation isolation; correct hazard/kicker behavior; replay return to manual plunger; deterministic table containment.
2. Add focused rule transitions: field-multiplier progression and exclusions; hazard spot banks, medal and booster banks; lane upgrades/toggles; wormhole open/closed/matching destinations; five hyperspace stages; fuel drain/refill; mission target selection, acceptance, prerequisite stages, completion/promotion, and abort behavior. Prefer concrete scores plus a related state/event assertion.
3. Validate targeted Space Cadet tests, inspect assertion quality and mutation gaps, then coordinate full `pnpm test` and `pnpm build` with the parent agent. Do not claim numerical coverage without a coverage run.

Success: retained collision/containment checks pass; new tests distinguish rules from their previous implementation and fail under plausible off-by-one, missing stage gating, wrong multiplier, wrong bank, replay reset, and acceptance-before-ramp-exit mutations.
