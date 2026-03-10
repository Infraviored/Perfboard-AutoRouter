# HoleRoute: Intelligent Perfboard AutoRouter

HoleRoute is a sophisticated web-based EDA tool specifically designed for prototyping on discrete perforated boards (perfboards/stripboards). It combines a modern React-based frontend with a powerful, heuristic-driven routing and placement engine.

![perfboard-autorouter-demo](https://via.placeholder.com/800x450/0d1117/58a6ff?text=HoleRoute+AutoRouter+Interface)

---

## 🚀 Overview

HoleRoute solves the complex problem of arranging electronic components and routing their connections on a standard 2.54mm grid. Unlike traditional PCB tools, it is optimized for the constraints of "through-hole" prototyping, where space is at a premium and every wire must navigate a discrete matrix of pins.

### Key Features
- **Heuristic Placement Engine:** Uses Simulated Annealing and Targeted Chain Compaction (TCC) to find the most compact component arrangement.
- **Advanced A* Router:** Handles discrete grid routing with support for multi-point nets, Steiner Tree approximations, and obstacle avoidance.
- **Topographical Optimization:** Employs "Plateau Exploration" to navigate flat energy landscapes where traditional gradient descent fails.
- **Real-time Camera Physics:** Smooth, reactive canvas with auto-framing and zoom-to-fit logic for a premium design experience.
- **Workflow-Driven UI:** Guided steps from initial JSON circuit definition to fully optimized physical layout.

---

## 🛠️ Technology Stack

- **Frontend:** React 19, Vite, Lucide React (Icons).
- **Styling:** Vanilla CSS with a custom-built premium dark-mode design system.
- **Engine:** Pure JavaScript optimization core (no heavy external dependencies).
- **Persistence:** LocalStorage-based state recovery for camera, board, and workflow progress.

---

## 🚦 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Infraviored/Perfboard-AutoRouter.git
   cd Perfboard-AutoRouter
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

---

## 🧠 Mathematical & Algorithmic Architecture

The core of HoleRoute is an advanced, heuristic-driven constraint solver that simultaneously handles 2D bin packing, pathfinding, and graph optimization.

### 1. Core Objective
The solver aims to find the global minimum of a highly non-convex, multi-objective cost function:
`E_total = W_f * failed_routes + W_a * area + W_p * perimeter + W_w * wire_length`

We employ a hybrid metaheuristic approach combining Simulated Annealing, greedy local search, graph-based pathfinding, and topographical plateau exploration.

### 2. Initial State & Representation
- **Components:** Bounding boxes (`w` x `h`) with local pin offsets.
- **Nets:** Topological graphs of pins requiring electrical connection.
- **Treadmill Coordinate System:** Moves the entire board center-of-mass to `(0, 0)` after mutations to prevent coordinate drift.

### 3. Component Placement Engine
Placement aims to maximize routing success while minimizing board real estate.
- **Simulated Annealing (SA):** Baseline macro-optimizer using HPWL (Half-Perimeter WireLength) as a fast energy approximation.
- **Boltzmann Distribution:** Propsals are accepted if they improve the state, or with a probability `P = e^(-ΔE / T)` if they don't, allowing the system to escape local minima.
- **Deep Scrambles:** If stagnation occurs, the solver applies wider randomized vectors to "shake" the board configuration.

### 4. Pathfinding Router (Discrete A*)
Constructs physical traces using wave-propagation and heuristics.
- **Multi-Point Nets:** Solves MST (Minimum Spanning Tree) approximations, treating existing paths as valid targets for subsequent pins.
- **Costs:** Weights Manhattan distance, penalizing occupied cells and unauthorized component traversal.

### 5. Advanced Geometric Solvers
These passes use **incremental routing** (ripping up only affected nets) for extreme speed:
- **Recursive Push Packing:** Inward gravity with chain-reaction shifts.
- **Affinity Packing:** Clusters components sharing multiple nets to resolve long "loops" early.
- **Orthogonal Rotate Optimize:** Tests all four orientations sequentially per component.
- **Wire-Driven Shrink:** Translates components along the tension vectors of their physical wire paths.
- **Topological Wire Absorption:** Slides components 1-step at a time along their actual traces ("peeling the onion").
- **Targeted Chain Compaction (TCC):** A sliding-puzzle optimizer that relocates "blockers" to shrink the overall bounding box.

### 6. Plateau Exploration
When standard mutations fail, `doPlateauExplore` walks across "flat" energy landscapes where area and completion are identical but internal topology varies. This BFS search discovers new "valleys" in the cost function that traditional descent cannot see.

---

## 📉 Optimization Pass Summary

| # | Pass | Trigger | Method |
|---|------|---------|--------|
| 1 | **Micro Search** | Every iter | Random nudge/rotate |
| 2 | **Deep Scramble** | Stagnation ≥ 12 | Global vector shake |
| 3 | **Simulated Annealing** | Step 8+ | HPWL placement pass |
| 4 | **Recursive Push** | Every iter | Inward gravity |
| 5 | **Affinity Packing** | Every iter | Cluster high-conn pairs |
| 6 | **Rotate Optimize** | Every iter | Exhausive 4-axis test |
| 7 | **Wire Absorption** | Every iter | Slide along traces |
| 8 | **TCC** | Every iter | Blocker relocation |
| 9 | **Plateau Explore** | High Stagnation | BFS equal-area states |

---

Built with ❤️ by the HoleRoute Team.
