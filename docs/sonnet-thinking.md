Now I have enough to provide a maximally rigorous, deep analysis. Let me synthesize the full picture.

***

## Core Problem Re-Framing

The problem is a **bi-level combinatorial optimization**. The outer level searches over component placements (discrete grid positions + discrete rotations), and the inner level is a deterministic, reproducible maze routing given that fixed placement. This separation is the central structural insight: once you accept that routing is a **pure function** of placement, the entire search collapses to searching over the placement space and querying a routing oracle. The routing oracle returns either a valid set of non-crossing routes or a failure, plus derived metrics (total wire length, maximum congestion density per grid channel).

Formally:

- Let $$ C = \{c_1, \ldots, c_n\} $$ be components with footprints $$ F_i $$ (sets of hole offsets relative to an anchor), rotation set $$ r_i \in \{0°, 90°, 180°, 270°\} $$, and grid positions $$ (x_i, y_i) \in \mathbb{Z}^2 $$.
- Let $$ \mathcal{N} $$ be the netlist: a set of hyperedges over all pins.
- Placement $$ P = \{(x_i, y_i, r_i)\} $$ induces absolute pin positions.
- The deterministic router $$ \text{Route}(P, \sigma) $$ takes placement and a net ordering $$ \sigma $$ and returns routes or failure.
- Objective: minimize $$ \text{BB}(P) = (x_{\max} - x_{\min} + 1) \times (y_{\max} - y_{\min} + 1) $$ subject to $$ \text{Route}(P, \sigma) \neq \text{FAIL} $$ for some $$ \sigma $$.  [github]

The no-crossing constraint on a single routing side is what makes this dramatically harder than typical two-layer PCB routing: the routing side is a planar graph, and planarity of the routing is a hard combinatorial constraint rather than a soft cost.  [arxiv]

***

## The Five Algorithmic Sub-Problems

### 1. Initial Orientation Selection (Crossing-Minimization Pre-pass)

Your intuition about rotations is formalized as follows. For each pair of connected components $$ (c_i, c_j) $$, define the **projected crossing count** $$ \kappa(r_i, r_j) $$ as the number of pairs of straight-line segments between connected pins that mutually intersect, under rotations $$ r_i $$ and $$ r_j $$ and an assumed relative layout. Summing over all pairs:

$$ K(R) = \sum_{\text{net pairs}} \kappa(r_i, r_j) $$

Minimizing $$ K(R) $$ over all rotation assignments $$ R = (r_1, \ldots, r_n) $$ is NP-hard (it is a form of **quadratic pseudo-boolean optimization**, equivalent to a QUBO problem)  [tcs.uos]. However:

- **Greedy local search**: For each component in sequence, flip to the rotation (0°/180° or all four) that minimizes $$ K $$ given the already-fixed neighbors. This is $$ O(n \cdot k \cdot m) $$ where $$ k $$ is the number of rotations and $$ m $$ is the average net size.
- **Iterated local search**: Do multiple rounds of greedy flipping until no single flip reduces $$ K $$; this finds a local minimum of crossing count.
- **Connection to barycenter heuristics**: When components are arranged in rows, the problem of choosing component orderings within a row to minimize crossings is exactly the **one-sided crossing minimization problem** on bipartite graphs, which is solvable approximately by median/barycenter methods.  [i11www.iti.kit]

The key engineering point: this pre-pass is cheap (no routing required) and can dramatically reduce the number of routing failures in subsequent steps.

### 2. Initial Placement Strategy (Whitespace-Aware)

The classic paradox: pack too tight → routing fails. Pack too loose → large bounding box. The right initial placement must be **routeable but compact enough to be a useful starting point**. Several strategies:

- **Force-directed placement with net springs**: Model each net as a spring connecting its pins with rest length = Manhattan distance. Simulate to equilibrium on a continuous plane, then snap to grid. Add a repulsion force between components to maintain whitespace.  [cseweb.ucsd]
- **Cluster-then-place**: Build a hierarchical tree by merging components that share many nets (minimum spanning tree of a "pin affinity" graph). Place high-affinity groups near each other in a slicing floorplan.  [ar5iv.labs.arxiv]
- **Perimeter seeding**: Place components around the perimeter of a candidate bounding box, ensuring that inter-component connections run through the interior (available routing channels). Then the compaction phase moves them inward. This is exactly your intuition — it guarantees routability at the cost of a large initial board.  [s2.smu]

### 3. Deterministic Routing Oracle Design

For a fixed placement, routing should be fast, deterministic, and expose useful feedback to the placement optimizer. Recommended design:

- **Grid graph formulation**: nodes are holes; edges connect orthogonally adjacent holes. An edge is blocked if a component body occupies that hole or if a previously routed net uses that edge.
- **Net ordering $$ \sigma $$**: route short nets (small Manhattan bounding box) first. Alternatively, for more advanced control, use a **Topo-GA** style genetic search over net orderings — this is the key innovation of the `striprouter` project.  [github]
- **A* with congestion penalties**: penalize edges in already-congested grid regions to spread routing across the available whitespace.
- **Rip-up and reroute (RRR)**: after a first pass, identify conflicting nets, rip them up, and re-route with elevated penalties on previously used resources. This is a standard multi-pass routing strategy.  [github]
- **Routing metadata for compaction**: the router should output per-channel congestion density $$ \delta(x, y) $$ = fraction of adjacent edges used. This feeds directly into the compaction cost function: regions with $$ \delta > 0.8 $$ are bottlenecks and should not be compressed further.

### 4. Greedy Compaction Algorithm (Your Core Idea — Formalized)

Your greedy compaction insight maps onto a well-studied class of **iterative improvement with a feasibility oracle**. Here is the formalized algorithm and its issues:

```
Input: routable placement P, bounding box BB(P)
repeat:
  improved ← false
  for each component c_i in random or priority order:
    for each delta ∈ {(-1,0),(+1,0),(0,-1),(0,+1)}:
      P' ← move c_i by delta in P
      if no component overlap in P' and BB(P') ≤ BB(P):
        R' ← Route(P', σ)
        if R' ≠ FAIL and BB(P') < BB(P):
          P ← P', R ← R'
          improved ← true; break
  if not improved: break
return P, R
```

This is a **coordinate descent compaction** with a routing feasibility check. Key properties:
- It is guaranteed to terminate (BB decreases monotonically, which is bounded below).
- It will get stuck in **local minima** (a component cannot be moved alone but could be moved as part of a group swap).
- The move operator set $$ \{(-1,0),(+1,0),(0,-1),(0,+1)\} $$ is too restricted; adding rotations and component swaps creates a much richer neighborhood.

**Improvements to escape local minima:**
- **Compound moves**: simultaneously translate $$ c_i $$ inward and re-route, then immediately attempt to also translate a neighboring component into the freed space (chain moves).
- **Bounding-box boundary exploitation**: if $$ c_i $$ is on the BB boundary, moving it inward by even 1 grid unit **shrinks the BB** — this move is always worth trying first. Prioritize boundary components.
- **Simulated annealing wrapper**: accept moves that temporarily increase BB by $$ \delta $$ with probability $$ e^{-\delta / T} $$, cooling $$ T $$ over time. This converts greedy compaction into a global search.  [ar5iv.labs.arxiv]
- **Two-phase strategy**: first run greedy compaction until stuck (fast), then run SA with compaction as the local operator (slower, escapes local minima).

### 5. Incremental Re-Routing for Fast Placement Evaluation

The bottleneck of compaction is the routing oracle call per candidate move. A full re-route of all nets for each attempted move is expensive. Two strategies to speed this up:

- **Incremental routing**: when component $$ c_i $$ moves, only rip up and re-route the nets directly connected to $$ c_i $$, plus any other nets whose paths intersected the cells that $$ c_i $$ vacated or now occupies. This reduces re-routing to a local operation.
- **Routing cost estimators**: for very fast candidate evaluation, use the **half-perimeter wirelength (HPWL)** of each net as a proxy for routability. A move that reduces total HPWL while not increasing local congestion is likely to remain routable. Accept the move tentatively, defer full re-routing to confirmation.  [cseweb.ucsd]

***

## The Optimal Research Question

Here is the maximally detailed research question you should submit to a research agent:

***

> **Research Question:**
>
> Consider the following **single-layer perforated-board placement and routing optimization problem**: you are given a netlist $$ \mathcal{N} $$ (a hypergraph where nodes are component pins and hyperedges are nets), a set of $$ n $$ rigid component footprints with discrete pin layouts, and a 2.54 mm hole grid. Components may be placed at any integer grid position with any axis-aligned rotation $$ r \in \{0°, 90°, 180°, 270°\} $$, subject to no-overlap constraints. All electrical connections must be routed as single-layer, orthogonal, non-crossing wire traces on one side of the board (i.e., the routing graph is planar). The **primary objective** is to minimize the bounding box area $$ W \times H $$ of the smallest rectangle enclosing all placed component holes. Secondary objectives (wire length, jumper count) matter only insofar as they affect feasibility or guide heuristics toward the primary objective.
>
> The key structural insight driving this research is that **routing is a deterministic function of placement**: for a fixed component placement and a fixed net ordering, a maze router (e.g., A* on the grid graph) produces a unique, reproducible set of routes or a failure signal. This means the full optimization reduces to searching the placement space (component positions and rotations), querying a deterministic routing oracle, and using the result to guide further search. The hard combinatorial challenge is the placement search itself.