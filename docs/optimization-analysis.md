# Optimization Architecture Analysis: Current vs. Proposed

This document details exactly how the AutoRouter currently optimizes component placement, contrasts it with the proposed "Greedy Compaction" architecture from our recent research, and provides concrete engineering recommendations.

---

## 1. What We Do Today: Multi-Stage Heuristic Pipeline

The optimization engine lives in two main files:
- **[optimizer.js](file:///home/schneider/Programs/autorouter/src/engine/optimizer.js)** — The outer optimization loop (`doOptimizeFootprint`) and plateau exploration entry point (`doPlateauExplore`).
- **[optimizer-algorithms.js](file:///home/schneider/Programs/autorouter/src/engine/optimizer-algorithms.js)** — All the individual geometric passes called by the outer loop.

Supporting modules:
- **[router.js](file:///home/schneider/Programs/autorouter/src/engine/router.js)** — Deterministic A* maze router (`route()`). Builds a `Grid`, registers all components, then routes every net sequentially via multi-target A*.
- **[grid.js](file:///home/schneider/Programs/autorouter/src/engine/grid.js)** — 2D grid with occupancy flags (`BLOCKED_COMP`, `BLOCKED_PIN`, `BLOCKED_WIRE`) and an optimized binary-heap A* implementation.
- **[placer.js](file:///home/schneider/Programs/autorouter/src/engine/placer.js)** — Component manipulation (`moveComp`, `rotateComp90InPlace`, `anyOverlap`), HPWL computation, and the Simulated Annealing placement pass (`anneal()`).
- **[initial-placement.js](file:///home/schneider/Programs/autorouter/src/engine/initial-placement.js)** — `placeInitial()`: scatters components randomly within a square zone around `(0,0)` with random rotations.

### 1.1 The `placeAndRoute` Flow (engine.js)

When a user clicks "Place & Route":
1. **Initial Placement** — `placeInitial()` scatters components randomly around `(0,0)` with `spread = sqrt(totalArea) * 1.5`.
2. **Simulated Annealing** — `anneal()` shuffles components using HPWL + Boltzmann acceptance to find a topologically favorable arrangement. No actual routing happens here — it only minimizes estimated HPWL.
3. **Full Route** — `route()` runs A* on every net.
4. **Retry loop** — If routing isn't 100%, try up to 100 random restarts.

### 1.2 The `doOptimizeFootprint` Flow (optimizer.js)

This is the core optimization loop. It runs on a nested structure: **Epochs (1+) → Iterations (up to 100)**. Inside each iteration:

| Step | Function | What it does | How it evaluates |
|------|----------|-------------|-----------------|
| 1 | **Micro Search** | Grabs ~15% of components randomly, nudges by ±1–2 or rotates | Full `route()` after all nudges |
| 2 | **Deep Scramble** (if `stagnation ≥ 12`) | Randomizes all positions within `[-3,+3]` of center | Full `route()` |
| 3 | **Simulated Annealing** (every 10th iter or `stagnation ≥ 8`) | `anneal()` pass using HPWL | Full `route()` after SA |
| 4 | **Recursive Push Packing** | Inward gravity towards connected-pin center-of-mass; recursive push chains | Full `route()` per push loop (up to 25 loops) |
| 5 | **Rotate Optimize** | Tests all 4 orientations per component | Full `route()` per rotation test (up to `3 × N` calls) |
| 6 | **Global Nudge** | Bumps all components in each cardinal direction | Full `route()` per direction (up to 4 calls) |
| 7 | **Wire-Driven Shrink** | Translates boundary components along wire tension vectors | Full `route()` per shrink attempt |
| 8 | **Plateau Exploration** (if `stagnation ≥ platThresh`) | BFS over equal-area placements | Full `route()` per neighbor evaluation |
| 9 | **Score Evaluation** | Final `route()` + `scoreState()` | Full `route()` |

The scoring hiearchy is: `Routing % → Area → Perimeter → Wire Length`.

### 1.3 Key Observation: The `route()` Bottleneck

**Every single pass in the pipeline ends with a full `route()` call.** This means:
- `route()` rebuilds the entire `Grid` from scratch
- Re-registers every component
- Re-routes every net via A*

For a board with 30 nets, moving one component and testing the result requires re-routing all 30 nets, even though typically only 1–5 nets are affected by a single-component move.

**Existing incremental routing exists** in [engine.js `updateIncrementalWires()`](file:///home/schneider/Programs/autorouter/src/engine/engine.js#L232-L302) — but it is only used for interactive drag-and-drop, never during optimization.

**Existing HPWL computation exists** in [placer.js `hpwl()`](file:///home/schneider/Programs/autorouter/src/engine/placer.js#L12-L44) — but it is only used inside `anneal()`, never as a pre-filter in the optimizer passes.

---

## 2. What Differs in the Proposed Architecture

The proposed "Greedy Compaction" architecture from the research abstracts the problem differently:

| Aspect | Current Pipeline | Proposed Greedy Compaction |
|--------|-----------------|--------------------------|
| **Philosophy** | Multiple specialized geometric heuristics applied sequentially | Single unified loop: "Does this move shrink or maintain the bounding box while keeping routes valid?" |
| **Initialization** | Random scatter around `(0,0)` → SA → hope for 100% routing | Start deliberately *oversized* (perimeter placement) → guaranteed 100% routing from step 1 |
| **Move evaluation** | Full board `route()` every time | HPWL pre-filter → Incremental routing (only affected nets) |
| **Plateau handling** | Dedicated `doPlateauExplore` with BFS over equal-area states | Not addressed — pure greedy freezes on plateaus |
| **Escaping minima** | Deep Scramble + SA + Plateau Explorer | SA wrapper (accept temporary BB increases with Boltzmann probability) |

---

## 3. Engineering Verdict

### 3.1 Don't Throw Away the Pipeline

The current pipeline has one genuinely irreplaceable component: **`doPlateauExplore`**. Discrete grid routing produces massive flat plateaus where hundreds of different placements yield identical bounding boxes. A pure greedy coordinate descent (accept only if `BB' < BB`) freezes solid on these plateaus. The plateau explorer performs a blind BFS over equal-area configurations, mapping the "floor" until it finds the edge of a descending slope. This is subtle, powerful, and not easy to recreate.

The other passes — `doRecursivePushPacking`, `tryShrinkAlongWires`, `tryRotateOptimize` — are also highly effective for the non-smooth, non-differentiable nature of 2D grid routing. Replacing them with a single greedy loop would lose these capabilities.

### 3.2 The Real Problem is Evaluation Speed

The pipeline's logic is sound. Its bottleneck is that **every candidate evaluation triggers a full `route()` call**. The fix is not to change the placement strategy — it is to make evaluation fast enough that the existing strategy can explore far more candidates per second.

### 3.3 Concrete Priority Order

1. **Incremental Routing in optimizer passes** — **Singular highest-leverage change.**
   - When a single component moves in `doRecursivePushPacking`, `tryRotateOptimize`, `tryShrinkAlongWires`, or `tryGlobalNudge`, only rip up and re-route the nets touching that component (and any nets whose paths intersect the old/new footprint).
   - Expected speedup: `n_nets / k_affected` ≈ **5–15× fewer A* calls per evaluation**.
   - The logic already exists in `engine.js:updateIncrementalWires()` — it needs to be generalized into a reusable function that the optimizer can call.

2. **Perimeter Initialization** — **Eliminates the infeasible-start problem entirely.**
   - Currently, `placeInitial()` scatters components randomly, and SA + scrambles spend many iterations just finding a 100%-routable configuration.
   - With perimeter initialization, the optimizer starts at `score.comp = 1.0` from step 1. Every subsequent epoch is a pure compaction problem ("compress only"), not "search + compress".
   - This changes the optimizer's convergence trajectory fundamentally and produces more consistent results across different netlists.

3. **HPWL Pre-Filter** — **One-sided filter only.**
   - Before calling `route()` (or incremental route), compute HPWL delta for affected nets. If HPWL clearly worsens (e.g., increases by >50%), reject the move immediately.
   - **Critical caveat**: HPWL is only a reliable proxy for 2-pin and low-fanout nets (≤3 pins). For multi-pin nets (power rails, SPI buses), HPWL can underestimate actual routing length significantly because it ignores Steiner topology. Use HPWL only to *reject* clearly bad moves, never to *accept* moves without routing confirmation.

4. **Orientation Pre-Pass** — **Cheap, one-time quality improvement.**
   - Before heavy optimization, quickly test rotations to minimize estimated crossing count.
   - Implement last since it doesn't affect the runtime bottleneck.

---

## 4. Inventory of Full `route()` Call Sites

Here is every location in the optimizer pipeline that currently calls `route()` and would benefit from incremental routing:

| File | Line | Context | Affected Component(s) |
|------|------|---------|----------------------|
| `optimizer.js` | 63 | Initial route before optimization | All (unavoidable) |
| `optimizer.js` | 78 | Route after switching to virtual workspace | All (unavoidable) |
| `optimizer.js` | 120 | Route after epoch scramble | All (unavoidable — full scramble) |
| `optimizer.js` | 156 | Route after SA pass | All (SA moves many components) |
| `optimizer.js` | 198 | Route after micro-mutations | ~15% of components moved |
| `optimizer.js` | 243 | Final evaluation route | All (unavoidable — final score) |
| `optimizer-algorithms.js` | 446 | `tryShrinkAlongWires` | **1 component** |
| `optimizer-algorithms.js` | 525 | `explorePlateauStates` | **1 component** |
| `optimizer-algorithms.js` | 572 | `tryRotateOptimize` | **1 component** |
| `optimizer-algorithms.js` | 672 | `doRecursivePushPacking` | Multiple (batch move), but could be incremental |
| `optimizer-algorithms.js` | 716 | `tryGlobalNudge` | All (translates everything — not incrementalizable) |
| `optimizer-algorithms.js` | 347 | `postOptimizePlateauTree` | **1 component** |

**Lines in bold** are the highest-value targets for incremental routing — they test single-component moves but pay the cost of a full board route.
