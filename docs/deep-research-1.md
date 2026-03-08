You are thinking about this in exactly the right abstraction: treat routing as a deterministic “oracle” and focus almost all algorithmic creativity on searching the discrete space of placements and rotations under a hard, planar single‑layer constraint, with bounding‑box area as the primary objective. [citeseerx.ist.psu]

Below I’ll (1) re‑organize your ideas into a very explicit algorithmic picture, especially your “move anything that doesn’t increase the bounding box” heuristic, and then (2) give you a single, extremely detailed research question you can hand to a research agent.

***

## Refined problem view

- Variables:
  - Each component $$c_i$$ has a discrete grid position $$(x_i, y_i)$$ and a rotation $$r_i \in \{0°, 90°, 180°, 270°\}$$.
  - All pins lie on a 2.54 mm grid (or 2.5 mm, depending on your board), and components cannot overlap.
- Constraints:
  - Single routing side, no via crossings: the route set must be planar on the grid graph (tracks cannot pass “through” each other).
  - All nets must be successfully routed, otherwise the placement is infeasible.
- Objective:
  - Minimize bounding‑box area $$\text{BB}(P) = W(P)\times H(P)$$, where $$P$$ is the full placement.
- Structural assumption:
  - For a fixed placement $$P$$ and a fixed net ordering $$\sigma$$, your maze router is deterministic and reproducible; that router is your **oracle**:  
    $$\text{Route}(P,\sigma)$$ → either a valid route set + metrics, or FAIL. [academia]

This mirrors how VLSI and PCB tools separate NP‑hard placement from deterministic or heuristic routing stages, often combining them iteratively. [citeseerx.ist.psu]

***

## Your greedy compaction idea, formalized

You described:

- Start from some routable placement with whitespace.
- As long as there exists *any* component that can be moved (or rotated) without increasing the bounding box, try it.
- After each accepted move, re‑evaluate and repeat until you have exhausted all such possibilities.

Formally, a “pure” version is:

1. Start from routable placement $$P$$ with routing $$R$$, with BB area $$A = \text{BB}(P)$$.
2. Repeat:
   - Set `improved = false`.
   - For each component $$c_i$$:
     - For each **local move** $$m$$ in some neighborhood (e.g. translations by ±1 in x/y, 90°/180° rotations):
       - Construct candidate placement $$P' = m(P, c_i)$$.
       - If components do not overlap and $$\text{BB}(P') \le A$$:
         - Re‑run routing: $$R' = \text{Route}(P',\sigma)$$.
         - If routing succeeds:
           - If $$\text{BB}(P') < A$$: set $$P:=P', R:=R', A:=\text{BB}(P')$$, set `improved = true`, and **restart** outer loops.
           - If $$\text{BB}(P') = A$$: you can decide whether to accept as a neutral move (might help future compaction) or skip.
   - Stop when a full pass yields no accepted move.

This is exactly a **local search / coordinate descent** in the space of placements, with the router as a feasibility oracle. [hjemmesider.diku]  

Key properties:

- It is **monotone in BB** (never increases area if you define moves that must satisfy $$\text{BB}(P') \le \text{BB}(P)$$ to be considered).
- It **terminates** because BB is a non‑negative integer that decreases only finitely many times.
- It will in general get stuck in **local minima**: you may need to move two or more components “together” (or accept a temporary BB increase) to reach a smaller BB overall, which the greedy rule forbids. [s2.smu]

So your algorithm is a perfectly sensible *baseline* and a good core around which to formulate research questions:

- What is the right neighborhood of moves (translations, rotations, swaps, small group moves)?
- How do we speed it up so we’re not re‑routing the whole board for every micro‑move?
- How do we escape local minima (annealing, GA, tabu, random restarts)?

***

## Deterministic routing as an oracle

Your assertion that “routing the pins is deterministic and reproducible” is very useful: you can design the router to:

- Always use the same net ordering strategy (e.g. shortest nets first or a fixed heuristic ordering).
- Always use the same cost function in A* (length + bend penalties + congestion penalties).
- Optionally include a limited rip‑up‑and‑reroute phase but still in a deterministic way given $$P$$ and $$\sigma$$. [academia]

Then for research purposes you can treat

$$
\mathcal{F}(P) =
\begin{cases}
\text{BB}(P) & \text{if Route}(P,\sigma)\neq\text{FAIL}\\
+\infty & \text{otherwise}
\end{cases}
$$

and say: “I am minimizing $$\mathcal{F}(P)$$ over discrete placements $$P$$. The router is a black‑box function evaluator that’s cheap enough to call many times.”

This is exactly the setting where simulated annealing and genetic algorithms are used for PCB/VLSI placement: they repeatedly mutate placements and use “wirelength + legality” (in your case: BB + success/failure) as the energy/fitness. [s2.smu]

***

## Orientation and net‑crossing considerations

Your specific intuition about rotating components so that “straight‑line connections between related pins don’t cross” fits naturally into a **pre‑processing orientation stage**:

- With components roughly arranged, you can virtually connect nets with straight (or Manhattan) segments and count intersections between those segments as a proxy for routing difficulty. [sciencedirect]
- Flipping or rotating a component that reduces this estimated crossing count usually correlates with easier single‑layer routing.
- The formal analogue is the **one‑sided crossing minimization** problem in layered graph drawing: given a bipartite graph (one layer fixed, one layer reorderable), find an order (or orientation) that minimizes crossings, which is NP‑hard but well‑studied with barycenter/median heuristics and local swaps. [sciencedirect]

So the research question should explicitly ask about:

- Cheap orientation heuristics that minimize an estimated crossing count before any real routing.
- How much that helps the eventual bounding‑box minimum that the greedy compactor can achieve.

***

## Incremental routing vs full reroute

Your greedy strategy becomes much more viable if “try a move” does not mean “reroute the entire board from scratch” each time. In the literature:

- Incremental / rip‑up‑and‑reroute techniques re‑route only the nets that are directly affected by a local change, which drastically reduces runtime. [citeseerx.ist.psu]
- In your context, moving one component mainly invalidates:
  - Nets directly attached to that component.
  - Nets whose paths now intersect with the component’s new footprint.
- Everything else can be left untouched; so the research question should explicitly ask for:
  - Conditions under which incremental routing is correct and complete,
  - And how to exploit locality to evaluate many candidate moves per second.

***

## Very detailed research question for an algorithm‑design agent

Here is a single, self‑contained research question that encodes all of this, tuned around your priorities (BB minimization, deterministic routing, greedy compaction):

> **Research Question: Greedy‑compaction‑driven placement optimization for single‑layer perforated‑board routing with a deterministic routing oracle**
>
> We consider the following problem: given
> - A netlist $$\mathcal{N}$$ describing which pins must be connected.
> - A set of rigid components $$C = \{c_1,\dots,c_n\}$$, each with a discrete footprint on a uniform perforated grid (2.54 mm pitch) and a finite set of allowed axis‑aligned rotations $$r_i \in \{0°, 90°, 180°, 270°\}$$.
> - A single routing side modeled as a 2D orthogonal grid graph (holes as nodes, 4‑neighborhood edges as potential tracks), on which tracks must not cross.
> 
> A **placement** $$P$$ assigns to each component $$c_i$$ a grid‑aligned position $$(x_i,y_i)$$ and a rotation $$r_i$$, such that no component footprints overlap and all pins lie on grid holes.
> 
> For a fixed placement $$P$$ and a fixed net ordering $$\sigma$$, we assume a **deterministic, reproducible maze router** $$\text{Route}(P,\sigma)$$, which either:
> - Returns a valid, single‑layer, non‑crossing routing for all nets, including derived metrics (wirelengths, congestion, etc.), or
> - Returns FAIL if no such routing exists under its rules.
> 
> The **primary objective** is to minimize the area of the occupied bounding box
> $$
> \text{BB}(P) = W(P)\times H(P),
> $$
> where $$W$$ and $$H$$ are the width and height of the smallest axis‑aligned rectangle enclosing all component holes. Secondary concerns (total wire length, number of bends, etc.) are relevant only insofar as they help us reach a smaller feasible bounding box.
> 
> We define the objective function
> $$
> \mathcal{F}(P) =
> \begin{cases}
> \text{BB}(P) & \text{if Route}(P,\sigma)\neq \text{FAIL},\$$3pt]
> +\infty & \text{otherwise},
> \end{cases}
> $$
> which collapses the full autorouting task into minimizing $$\mathcal{F}$$ over the discrete placement space. Since placement and routing are individually NP‑hard for PCBs and VLSI, we expect this combined problem to be at least NP‑hard and require heuristic and metaheuristic approaches rather than exact algorithms.[][][]
> 
> The central **algorithmic idea to be investigated** is a family of **greedy compaction algorithms** that:
> 1. Start from an oversized but routable placement with deliberate whitespace.
> 2. Iteratively apply small, local moves (translations and rotations) to components, **only accepting moves that do not increase, and preferably decrease, the bounding‑box area**, and that remain fully routable according to the deterministic router.
> 3. Terminate when a full pass over all components and all local moves yields no further accepted move.
> 
> The research task is to study, both theoretically and experimentally, how to design and optimize such greedy‑compaction schemes and their supporting sub‑routines (orientation selection, initial placement, net ordering, incremental routing), with the **over‑arching goal of minimizing the final bounding‑box area**. Concretely:
> 
> 1. **Component orientation and net‑crossing minimization (pre‑placement stage).**  
>    - Define a fast, purely geometric or graph‑based estimate of “expected crossings” between nets as a function of component rotations, assuming an approximate relative ordering or row structure of components. This may be modeled as a one‑sided or two‑sided edge crossing minimization problem on a bipartite graph, which is known to be NP‑hard even in restricted cases.[][][]  
>    - Investigate local search heuristics (e.g. flipping or rotating one component at a time to reduce estimated crossings) and barycenter/median‑based heuristics from layered graph drawing. Quantify:
>      - How reliably a lower estimated crossing count predicts successful routing on a single layer.
>      - To what extent a “good” orientation assignment reduces the minimum bounding box achievable later by greedy compaction.
> 
> 2. **Construction of an initial routable placement with controlled whitespace.**  
>    - Propose and compare several strategies for generating an initial placement:
>      1. **Perimeter placement:** place components around the perimeter of an oversized rectangular region, leaving the interior largely free for routing.  
>      2. **Force‑directed placement:** continuous optimization where nets act as springs and components experience repulsion; then snap the result to grid.[]  
>      3. **Cluster‑then‑place:** cluster components by net connectivity and place high‑affinity groups close to each other using a slicing or partitioning floorplan.[][]  
>    - For each strategy, evaluate:
>      - Typical initial BB size vs. the theoretical minimum.
>      - Routing success rate on first attempt.
>      - Sensitivity of the **final** BB after compaction to the choice of initial placement strategy.
> 
> 3. **Precise definition and analysis of the greedy compaction algorithm.**  
>    - Formalize the local move set:
>      - Translations by one grid step in ±x/±y directions.
>      - Rotations by 90° or 180°.
>      - (Optionally) component swaps or small group moves, where two or more components are rearranged as a block.  
>    - Define the acceptance rule:
>      - Baseline: accept only moves where $$\text{BB}(P') \le \text{BB}(P)$$ and $$\text{Route}(P',\sigma)\neq\text{FAIL}$$.  
>      - Variants: allow neutral moves ($$\text{BB}(P') = \text{BB}(P)$$) if they reduce a secondary cost (e.g. total approximate Manhattan wirelength or local congestion) to help expose future compaction moves.  
>    - Investigate:
>      - Worst‑case and empirical number of routing‑oracle calls until convergence.
>      - Structure and frequency of local minima (placements where no single permitted move improves or maintains BB while preserving routability, yet a strictly smaller BB is achievable through multi‑component moves).
>      - The impact of expanding the neighborhood (e.g. including 2‑component swaps) vs. runtime.
> 
> 4. **Incremental vs full rerouting for move evaluation.**  
>    - Design an **incremental routing strategy** where a candidate move of one component only triggers rip‑up and re‑route of:
>      - Nets connected to that component.
>      - Nets whose existing paths intersect tiles now occupied by the moved component.  
>    - Prove or empirically validate conditions under which such incremental routing is equivalent to a full reroute in terms of feasibility (i.e., no false positives where incremental routing fails but a full reroute would have succeeded).  
>    - Measure performance vs. always doing a full reroute for each move evaluation. Quantify the speedup and its effect on convergence of the greedy compactor.
> 
> 5. **Net‑ordering strategies inside the deterministic router.**  
>    - Study how different fixed net orderings $$\sigma$$ (shortest‑net‑first, most‑constrained‑first, etc.) affect routing success and the compactor’s ability to shrink the BB for a given placement.[][]  
>    - Explore whether more advanced strategies (e.g. evolutionary optimization of net orderings as in genetic routing approaches for single‑layer PCBs) yield significantly better BB minima or if simpler heuristics suffice for the purposes of compaction.[][]  
>    - Decide how to integrate net‑ordering optimization with placement moves: fixed globally, periodically re‑optimized, or co‑optimized per placement.
> 
> 6. **Escaping local minima: metaheuristic extensions of greedy compaction.**  
>    - Extend the pure greedy algorithm into:
>      - A **simulated annealing** scheme that occasionally accepts moves that temporarily increase BB or cause rerouting with slightly worse metrics, with a temperature schedule controlling this exploration.[][]  
>      - A **genetic algorithm** where individuals encode full placements (positions + rotations), and the fitness function is primarily $$\text{BB}(P)$$ with hard penalties for unroutable placements.[][]  
>      - **Tabu search** that forbids cycling back to recently visited placements.  
>    - Compare these metaheuristics empirically against the pure greedy compactor in terms of:
>      - Best‑achieved BB.
>      - Runtime (number of router calls).
>      - Robustness across different netlists (sparse vs dense, many vs few long nets).
> 
> 7. **Lower bounds and stopping criteria.**  
>    - Derive theoretical lower bounds on the minimum possible BB for a given netlist and set of component footprints, for instance:
>      - Area required to place components alone.
>      - Plus minimum number of routing channels implied by cut‑based arguments (e.g. how many wires must cross a given cut line if nets are partitioned there, relating to channel‑routing style analyses).[][]  
>    - Investigate how tight these bounds are in practice and whether they can be used to:
>      - Prove near‑optimality of a found placement.
>      - Define practical stopping conditions (“we are within X% of the theoretical lower bound, further search is unlikely to pay off”).
> 
> The research deliverables should include:
> - A formal definition of the greedy compaction framework with a deterministic routing oracle.
> - A comparative evaluation of different move sets, acceptance rules, and incremental routing schemes on representative netlists (e.g. real circuits manually laid out on stripboard).
> - A recommendation for a **practical algorithm configuration** (initial orientation + initial placement + greedy/SA/GA compaction + routing strategy) that gives the best trade‑off between runtime and minimal bounding‑box area on single‑layer perforated boards.

If you hand roughly this question to a research/algorithm‑design agent, you’ll get very targeted suggestions on which exact heuristics and metaheuristics to implement around your core greedy “never increase the bounding box” idea, and how to structure experiments to know when you’re close to the best achievable footprint.