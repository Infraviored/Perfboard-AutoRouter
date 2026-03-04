# Optimization Architecture Analysis: Current vs. Proposed

This document details exactly how the AutoRouter currently optimizes component placement, contrasts it with the proposed "Greedy Compaction" architecture from our recent research, and provides an engineering opinion on the best path forward.

---

## 1. What We Do Today: Multi-Stage Heuristic Loop

The current optimization engine (`src/engine/optimizer.js`) is a **multi-staged, composite heuristic pipeline**. Rather than running a single unified search metric, it applies a series of specialized physical and geometric algorithms to "massage" the board into a smaller footprint. 

It runs on a nested loop structure (Epochs -> Iterations). Currently, inside each iteration, the following passes are executed sequentially:

1. **Micro Search & Deep Stagnation Handling:** 
   - If the solver is deeply stuck, it performs a " Macro Scramble", randomizing positions in a wider radius.
   - Otherwise, it does a "Micro Search": grabbing ~15% of components randomly and nudging them by `±1` or `±2` units or aggressively rotating them to shake out of local minima.

2. **Full Board Re-Routing:** 
   - After the shakes, the deterministic A* router attempts to route *all* nets from scratch. This gives a baseline for the following geometric passes.

3. **Recursive Push Packing (`doRecursivePushPacking`):** 
   - A greedy geometric pass that applies an inward gravity vector to outer components. It systematically attempts to shift columns or rows of components simultaneously toward the center to strictly compress the bounding box.

4. **Orthogonal Rotate Optimize (`tryRotateOptimize`):** 
   - Iterates sequentially over every component, checks all four 90-degree orientations, and permanently commits to the orientation that locally maximizes successful wire completion and minimizes wire length.

5. **Global Nudge (`tryGlobalNudge`):** 
   - Bumps components in cardinal directions collectively to find slight alignment efficiencies.

6. **Wire-Driven Shrink (`tryShrinkAlongWires`):** 
   - Calculates the tension vectors of the physically routed paths. It attempts to translate components directly along the axis of their connected traces to reel them in and eliminate zig-zag wire geometries.

7. **Plateau Exploration (`doPlateauExplore`):** 
   - If the score stagnates for a long time, the engine activates Plateau Exploration. Because discrete grid routing has large "flat" score landscapes, this pass systematically branches out, strictly accepting new states that have *identical* area and perimeter (even if internal wirelength worsens), allowing it to "walk" across the flat plateau blindly uncovering the edge of a new gradient descent valley.

Throughout this process, the `scoreState` function mathematically ranks candidates strictly based on: `Routing % -> Area -> Perimeter -> Wire Length`.

---

## 2. What Differs in the Proposed Architecture

The proposed architecture from the research abstracts the problem in a much more rigid **Bi-Level Combinatorial Search**: viewing the router simply as a binary Oracle and driving placements purely by Coordinate Descent on the Area bounding box.

The key differences are:

1. **Unified Objective vs. Kitchen Sink:**
   - **Current:** Uses multiple different geometric heuristics (pushing towards center, shrinking along wires, rotating).
   - **Proposed:** Uses a single, unified loop: *Does moving this component 1 tile inward decrease or maintain the Area without breaking routes? If yes, keep it. Repeat.*

2. **Algorithmic Flow:**
   - **Current:** Starts small (at `0,0`) and relies on Simulated Annealing/Scrambling to avoid getting trapped in overlapping component states. 
   - **Proposed:** Starts deliberately *oversized* (e.g., perimeter placement) to guarantee 100% routability, and strictly compresses inwards monotonically.

3. **Evaluation Speed (Filters & Incremental Routing):**
   - **Current:** Frequently calls `route()` to completely route the whole board from scratch to evaluate a new micro-state. This is the main computational bottleneck.
   - **Proposed:** Before ever calling the router, it uses a **fast HPWL pre-filter** (Half-Perimeter WireLength) and a congestion map. If an evaluation passes, it uses **Incremental Routing** (only ripping up the specific nets affected by the moved component), making evaluations orders of magnitude faster.

4. **Orientation:**
   - **Current:** Re-routes and brute-forces rotations repeatedly during the iterative loop.
   - **Proposed:** Calculates an "Orientation Pre-Pass" that heuristically minimizes the intersection of virtual straight-line connections, fixing rotations early before heavy routing begins.

---

## 3. Engineering Opinion: Is Switching Better?

**Complete replacement is likely NOT the best immediate step.** 

While the "Greedy Compaction" theoretically guarantees a monotonic shrinking of the bounding box, simple local coordinate descent is notorious for getting trapped in local minima. If you only accept moves that *never* step backwards, components can easily lock each other out (e.g., moving Component A inward requires moving Component B out of the way first). The current "kitchen sink" approach—specifically `tryShrinkAlongWires` and `doPlateauExplore`—is highly creative and actually very effective at navigating the discrete, non-differentiable plateaus of perfboard placement that a simple greedy algorithm would fail at.

### Recommended Path Forward (The Best of Both Worlds)

Instead of discarding our multi-stage pipeline for a pure greedy loop, we should **graft the best performance techniques from the proposed research into our current engine:**

1. **Implement Incremental Routing (Highest Priority):**
   - We already have `updateIncrementalWires` in `engine.js`. However, `optimizer.js` still calls a full board `route()` repeatedly. If `doRecursivePushPacking` and `tryRotateOptimize` only incrementally ripped up affected nets, the current engine would become blisteringly fast.

2. **Integrate Fast Filters (HPWL):**
   - In `Micro Search` and `Plateau Explore`, we should evaluate the mathematical HPWL *before* validating with the actual A* router. If moving a component triples the HPWL, we shouldn't waste ms routing it.

3. **Adopt Ovesized Perimeter Initialization:**
   - Instead of initializing around `(0,0)` and scrambling, starting with an oversized, 100% valid routing and letting our `doRecursivePushPacking` compress it inwards will prevent the solver from spending its early epochs failing to route dense overlaps.

**Conclusion:** The logic of what we do today is actually extremely robust for the highly un-smooth nature of 2D grid routing. The actual problem isn't the strategy—it's the computational cost of evaluating each candidate. Migrating performance optimizations (Incremental Routing + HPWL filters) to our current multi-stage solver will yield massive improvements without sacrificing the complex plateau-navigating heuristics we've already built.
