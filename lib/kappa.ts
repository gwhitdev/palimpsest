export function fleissKappa(
  annotations: { coder_id: string; tech_id: string; document_id: string }[],
): number {
  const docs = [...new Set(annotations.map((a) => a.document_id))];
  const coders = [...new Set(annotations.map((a) => a.coder_id))];
  const cats = [...new Set(annotations.map((a) => a.tech_id))];

  const n = coders.length;
  if (n < 2 || docs.length === 0 || cats.length === 0) return 0;

  const matrix = docs.map((doc) =>
    cats.map(
      (cat) =>
        annotations.filter(
          (a) => a.document_id === doc && a.tech_id === cat,
        ).length,
    ),
  );

  const N = matrix.length;

  const Pj = cats.map((_, j) => {
    const sum = matrix.reduce((acc, row) => acc + row[j], 0);
    return sum / (N * n);
  });

  const Pi = matrix.map((row) => {
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (rowSum <= 1) return 0;
    const sumSq = row.reduce((acc, nij) => acc + nij * nij, 0);
    return (sumSq - rowSum) / (rowSum * (rowSum - 1));
  });

  const Pbar = Pi.reduce((a, b) => a + b, 0) / N;
  const PeBar = Pj.reduce((acc, p) => acc + p * p, 0);

  if (PeBar === 1) return 1;
  return (Pbar - PeBar) / (1 - PeBar);
}

export function kappaInterpretation(k: number): string {
  if (k >= 0.8) return "Almost perfect";
  if (k >= 0.7) return "Acceptable";
  if (k >= 0.6) return "Moderate";
  if (k >= 0.4) return "Fair";
  return "Poor - revise codebook";
}
