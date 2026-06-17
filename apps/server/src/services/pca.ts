/**
 * Tiny PCA for projecting high-dimensional embeddings to 2-D for the
 * vector-space map. Uses "dual PCA" (eigendecomposition of the n×n Gram
 * matrix) because the corpus is small (n ≪ dims), then lifts the principal
 * axes back into feature space so unseen query vectors can be projected too.
 */

export interface Projector {
  project(vec: number[]): [number, number];
}

/** Jacobi eigenvalue algorithm for a symmetric n×n matrix. */
function jacobiEigen(A: number[][], maxSweeps = 60): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((row) => row.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-12) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let i = 0; i < n; i++) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip - s * aiq;
          a[i][q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i++) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = c * api - s * aqi;
          a[q][i] = s * api + c * aqi;
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i][p];
          const viq = V[i][q];
          V[i][p] = c * vip - s * viq;
          V[i][q] = s * vip + c * viq;
        }
      }
    }
  }
  const values = a.map((row, i) => row[i]);
  return { values, vectors: V };
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function fitPCA(vectors: number[][]): Projector {
  const n = vectors.length;
  const D = vectors[0]?.length ?? 0;
  if (n < 2 || D === 0) {
    return { project: () => [0, 0] };
  }

  // Mean-center
  const mean = new Array<number>(D).fill(0);
  for (const v of vectors) for (let i = 0; i < D; i++) mean[i] += v[i];
  for (let i = 0; i < D; i++) mean[i] /= n;
  const X = vectors.map((v) => v.map((x, i) => x - mean[i]));

  // Gram matrix (n×n) and its eigendecomposition
  const G: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    const d = dot(X[i], X[j]);
    G[i][j] = d;
    G[j][i] = d;
  }
  const { values, vectors: U } = jacobiEigen(G);
  const order = values.map((val, idx) => idx).sort((p, q) => values[q] - values[p]);
  const top = order.slice(0, 2);

  // Lift principal axes back into feature space: axis_k = Σ_j U[j][k] * X[j]
  const axes: number[][] = top.map((k) => {
    const axis = new Array<number>(D).fill(0);
    for (let j = 0; j < n; j++) {
      const w = U[j][k];
      const xj = X[j];
      for (let d = 0; d < D; d++) axis[d] += w * xj[d];
    }
    let nrm = Math.sqrt(dot(axis, axis)) || 1;
    for (let d = 0; d < D; d++) axis[d] /= nrm;
    return axis;
  });
  while (axes.length < 2) axes.push(new Array<number>(D).fill(0));

  // Scale training projections to ~[-1, 1] for plotting
  let maxX = 1e-9;
  let maxY = 1e-9;
  for (const v of X) {
    maxX = Math.max(maxX, Math.abs(dot(v, axes[0])));
    maxY = Math.max(maxY, Math.abs(dot(v, axes[1])));
  }

  return {
    project(vec: number[]): [number, number] {
      const c = vec.map((x, i) => x - mean[i]);
      return [dot(c, axes[0]) / maxX, dot(c, axes[1]) / maxY];
    },
  };
}
