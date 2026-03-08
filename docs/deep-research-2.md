The most practical “best” implementation is: build a deterministic single‑layer maze router as an oracle, then wrap it in a greedy compaction placer that only accepts moves which keep the board routable and do not increase the bounding‑box; use cheap HPWL and crossing heuristics to avoid calling the router unnecessarily, and add simulated annealing later if you need to escape local minima. [eng.uwo]  

Below is a concrete, implementation‑oriented plan.

***

## 1. System architecture

Implement three clearly separated modules:

- **Model layer**
  - Board grid: 2D array of cells (holes) with occupancy flags for components and tracks.
  - Components: footprint mask (set of occupied cells relative to an anchor), list of pin offsets, allowed rotations.
  - Nets: list of pin references; for each routed net, list of grid segments it occupies.

- **Routing oracle (deterministic single‑layer router)**
  - Given placement $$P$$ and a fixed net order, returns either a completed routing (set of paths) or FAIL.
  - Internally uses A* or Lee’s algorithm on the grid graph; optionally with rip‑up/reroute. [eecs.northwestern]

- **Placement engine**
  - Orientation pre‑pass (flip/rotate components to reduce estimated crossings).
  - Initial placement (loose, obviously routable).
  - Greedy compaction loop that mutates placements and queries the router.
  - Optional metaheuristics (simulated annealing / GA) once the basic loop works. [eng.uwo]

This separation lets you improve the router or the placer independently.

***

## 2. Deterministic single‑layer router

### 2.1 Grid routing core

Implement a standard maze router:

- Graph:
  - Nodes = holes on your perfboard grid.
  - Edges = N/S/E/W neighbors if spacing rules allow a track there.
  - An edge is blocked if:
    - It lies inside a component footprint (except at pins).
    - It is already used by another routed net.

- Algorithm:
  - Use Lee’s breadth‑first algorithm or A* (Manhattan heuristic) to find a shortest path between two pins. [eecs.northwestern]
  - For multi‑pin nets, build a minimum spanning tree over pin positions and route pin‑to‑tree segments sequentially.

Make this deterministic via:

- Fixed tie‑breaking order for neighbors (e.g. up, right, down, left).
- Fixed pin ordering within a net.
- Fixed net ordering $$\sigma$$ (see below).

### 2.2 Net ordering and rip‑up/reroute

- Start with a simple deterministic order, e.g. sort nets by:
  - Descending estimated difficulty: larger half‑perimeter bounding box first, or nets crossing tight channels first. [eng.uwo]
- If routing fails:
  - Implement a simple rip‑up‑and‑reroute loop:
    - Identify congested regions or nets that block many others.
    - Rip up those nets and re‑route them later with increased “cost” for using already crowded edges. [eecs.northwestern]

Keep this module small and robust first; you can add sophistication later.

***

## 3. Orientation and initial placement

### 3.1 Orientation pre‑pass (cheap crossing heuristic)

Goal: choose rotation for each component before heavy search so that straight‑line “virtual” connections cross as little as possible; this usually improves single‑layer routability. [sciencedirect]

Implementation sketch:

- For each pair of connected components $$(c_i, c_j)$$, given tentative positions (e.g. on a coarse grid):
  - For each of the 2 or 4 rotation choices of each component, compute:
    - Positions of its pins.
    - Straight or Manhattan segments between corresponding pins.
  - Count segment intersections as “estimated crossings”.
- Local search:
  - Iterate over components; for each, try all allowed rotations while neighbors are fixed and pick the one with minimal total crossing count.
  - Repeat passes until no single rotation change improves the estimate.

This is cheap and does not call the router; it just sets a good starting point for the compactor.

### 3.2 Initial placement with whitespace

You want an obviously routable but oversized board:

- Simple, pragmatic strategy (good starting point):
  - Compute a graph where components are nodes and edge weights are number of nets between them.
  - Use this as a spring layout (force‑directed) or just a greedy clustering:
    - Place most‑connected components near the center, less‑connected near the periphery.
  - Snap positions to your hole grid and add a generous margin between footprints.
- Or very simple MVP:
  - Sort components by degree (number of nets).
  - Lay them out in a loose rectangular grid (rows/columns) with 1–2 empty grid holes between footprints in both x and y.
  - Place “hub” components near the middle of this grid.

Then run the router once; if it fails, expand the outline or spacing and try again.

***

## 4. Greedy compaction algorithm (core of your idea)

This is where most of the “intelligence” lives.

### 4.1 Move set

For each component $$c_i$$, define local moves:

- Translations: $$(\Delta x,\Delta y) \in \{(\pm 1,0),(0,\pm 1)\}$$.
- Rotations: 90°/180° (verify allowed by your footprints).
- Optional later: swap the locations of two components of similar size.

### 4.2 Acceptance policy

Maintain current placement $$P$$, routing $$R$$, and area $$A = \text{BB}(P)$$.

Pseudocode:

```pseudo
repeat
  improved = false
  for c in components_ordered_by_boundary_priority(P):
    for move in candidate_moves(c):
      P' = apply_move(P, c, move)
      if overlaps(P'): continue
      if BB(P') > A: continue

      if !passes_fast_filters(P', P): continue  // HPWL & congestion, see below

      (ok, R') = incremental_route(P, R, P', c)
      if !ok: continue

      if BB(P') < A:
        P = P'; R = R'; A = BB(P')
        improved = true
        goto restart_outer_loop

  if not improved: break
restart_outer_loop:
until false
```

Key design choices:

- **Component ordering**: always try components on the *current* bounding‑box boundary first (they can actually shrink the box). Then process interior components.
- **Neutral moves** ($$\text{BB}(P') = A$$):
  - Either disallow initially (pure greedy on area).
  - Or allow them only if they reduce a secondary score (HPWL or congestion), since they may enable future area reductions.

### 4.3 Fast filters before routing

Since routing calls are expensive, filter candidate moves:

- **HPWL filter**:
  - Precompute the sum of net half‑perimeter wirelengths (HPWL) for current placement. [eng.uwo]
  - For a candidate move, recompute HPWL only for nets touching that component.
  - If HPWL explodes (e.g. ratio > some threshold), skip the move.
- **Local congestion filter**:
  - Keep a simple congestion map: for each grid edge, count how many nets use it.
  - For a move that shrinks a gap, estimate how many nets would have to pass through that vertical/horizontal slice; if it’s already near capacity, skip.

These are just heuristics to avoid wasting router calls on clearly bad moves.

### 4.4 Incremental routing

Don’t re‑route everything on every move:

- Given old placement $$P$$, new placement $$P'$$, and previous routing $$R$$:
  - Identify nets incident to moved component $$c$$.
  - Identify any other nets whose routed segments lie in cells now occupied by $$c$$.
- Rip up only those nets from $$R$$, leaving all others untouched.
- Re‑route those nets in a fixed order with your maze router; if any fails, reject the move and restore the old routing. [eecs.northwestern]

This is standard in ASIC/PCB routers when doing detailed optimization and gives large speedups. [dl.acm]

***

## 5. When greedy stalls: add simulated annealing (optional)

Once the pure greedy compaction works, you can add a light simulated annealing layer to escape local minima:

- State = placement $$P$$, with routing $$R$$.
- Energy = bounding box area $$A$$; add a small penalty if HPWL is huge or congestion is bad.
- Moves = same as in greedy (translations, rotations, occasional swaps).
- Acceptance:
  - If move yields feasible routing and $$A' < A$$: accept.
  - If feasible but $$A' \ge A$$: accept with probability $$\exp(-(A'-A)/T)$$.
  - Cool temperature $$T$$ slowly.

SA for placement/floorplanning is well‑established and works well with HPWL and area‑driven cost functions. [eng.uwo]

In practice, I would:

1. Run pure greedy compaction to a local minimum (fast).
2. Start SA from that placement with a limited move budget, allowing occasional temporary area increases.
3. If SA finds a smaller BB, optionally run greedy again from there to squeeze out remaining slack.

***

## 6. Concrete implementation order

Given you’re one person building this from scratch, I would implement in this sequence:

1. **Data model and visualization**
   - Board grid, components, netlist, simple drawing of placement.

2. **Deterministic router MVP**
   - A* or Lee on a single layer; fixed net order (e.g. shortest nets first).
   - No rip‑up at first; just fail if it cannot complete.

3. **Naive initial placement**
   - Loose rectangular arrangement with big spacing, no orientation optimization yet.
   - Verify that routing works on a few sample designs.

4. **Greedy compaction v1**
   - Only ±1 translations; no rotations.
   - Full reroute on each accepted move.
   - No HPWL or congestion filters.

5. **Optimizations**
   - HPWL filter before routing.
   - Incremental rip‑up/reroute for affected nets only.
   - Better component ordering (boundary first).
   - Orientation pre‑pass.

6. **Metaheuristics (if needed)**
   - Simulated annealing around the greedy core.
   - Later, consider GA‑style placement search or Topo‑GA net ordering if you still want more performance, taking inspiration from stripboard GA autorouters. [github]

If you want, next step I can help you design concrete data structures and the exact A* cost function for the router, or sketch class layouts/Python prototypes that match this architecture.