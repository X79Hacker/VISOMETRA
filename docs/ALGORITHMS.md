# Algorithms

Coordinates: one grid cell is **500 units** (editor pixels); the traced image
square is 16 × 500 = 8000 units. With a cell of 3.4 cm, lengths are scaled by
3.4 / 500 and areas by (3.4 / 500)².

## 1. Boundary — cubic Bézier curves

Each segment between two anchors is a cubic Bézier

```
B(t) = (1−t)³·P0 + 3(1−t)²t·P1 + 3(1−t)t²·P2 + t³·P3,   0 ≤ t ≤ 1
```

with anchors P0, P3 and handles P1, P2.

- **Automatic smooth handles** (Catmull-Rom): handle = anchor ± (next − previous) / 6.
- **Straight segments**: both inner handles sit on the anchors, so the cubic is an exact line.
- **Line → curve joints** follow the line’s direction when the two meet within 35°,
  otherwise the joint stays a corner (no hook).
- All control points are clamped to the image/cell, and a Bézier lies inside the
  convex hull of its control points, so the curve never leaves it.

## 2. Exact area — Green’s theorem + Gauss–Legendre

```
A = ½ ∮ (x dy − y dx)
```

On a cubic segment `x·y′ − y·x′` is a degree-5 polynomial in t; **3-point
Gauss–Legendre quadrature** (nodes ½ ± √15/10, ½; weights 5/18, 8/18, 5/18) is
exact for degree ≤ 5, so the Bézier area has no approximation error.

Perimeter: Gauss–Legendre on |B′(t)| with every segment split in 8.

## 3. Shoelace area (polygons)

```
A = ½ |Σ (x_i · y_{i+1} − x_{i+1} · y_i)|
```

## 4. Fourier series — epicycles (frequency, amplitude, phase)

The closed outline is a point moving in the complex plane, `z(t) = x(t) + i·y(t)`,
with t ∈ [0, 1) proportional to **arc length**. It is written as

```
z(t) = Σ_k c_k · e^{i·2π·k·t},   k = −500 … 500
```

For a polygon (points P_j at arc-length parameters t_j, slopes
s_j = (P_{j+1} − P_j) / (t_{j+1} − t_j)) the coefficients are computed **exactly**
(integration by parts, no sampling):

```
c_0 = Σ_j (t_{j+1} − t_j) · (P_j + P_{j+1}) / 2
c_k = (1 / (2πk)²) · Σ_j s_j · ( e^{−i2πk·t_{j+1}} − e^{−i2πk·t_j} ),   k ≠ 0
```

Each coefficient is one circle:

| | |
|---|---|
| frequency | k (k > 0 counter-clockwise, k < 0 clockwise) |
| amplitude | \|c_k\| (radius) |
| phase | arg c_k (angle at t = 0) |

Circles are sorted by amplitude and the largest N are kept (default 200).

- **Fourier area**: `A = π · |Σ k · |c_k|²|` (Green’s theorem + Parseval).
- **Cumulative area** of row n: the same sum over circles 1 … n.
- **Reconstruction error**: mean distance from the outline’s points to 400
  samples of the curve rebuilt from the kept circles.

Sharp corners (e.g. a fully covered square cell) make small wiggles in the
rebuilt curve near the corners (Gibbs effect); the areas are unaffected.

## 5. Grid split — Sutherland–Hodgman clipping

1. The Bézier outline is flattened to a polygon: straight segments exactly, curves
   with chords of at most 1 unit.
2. The polygon is clipped against every cell square with **Sutherland–Hodgman**
   (clip against left, right, top, bottom edges in turn; keep inside points, add the
   crossing point where the outline crosses an edge).
3. Each piece is shifted to the cell’s own 0–500 coordinates, its area is the
   shoelace area, and it is measured with the Fourier series of section 4.

Clipping to a convex window keeps the area exactly, so the cell areas add up to the
total. If the region enters a cell twice, the two parts are joined by a zero-width
edge along the cell border; it adds no area.

## 6. Interaction details

- **Pointer → canvas**: pointer positions are whole pixels and a canvas edge can lie
  on a fractional pixel, so the reachable span `ceil(left) … floor(right)` is mapped
  onto exactly 0 … 500.
- **Edge snapping**: points within 8 screen pixels of a border land on it.
- **Zoom about the cursor**: the view is shifted so the point under the mouse stays
  put; wheel factor `exp(−0.0015 · deltaY)` (pinch: `0.01`), with line/page wheel
  units normalised.
- **Sharp zoom**: the editor canvas backing store is resized to the displayed size
  (capped at 3200 px).
