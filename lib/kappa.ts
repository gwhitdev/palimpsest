export type TechniqueStatus = "DRAFT" | "UNDER REVISION" | "LOCKED";

export type KappaResult = {
  techId: string;
  kappa: number;
  label: string;
  colour: "red" | "amber" | "green";
  action: string;
  coderCount: number;
  docCount: number;
  status: TechniqueStatus;
  disagreements: number;
  note?: string;
};

export type KappaSummary = {
  overall: number;
  byTechnique: KappaResult[];
  roundId: string;
  calculatedAt: string;
};

type BaseAnnotation = {
  coder_id: string;
  document_id: string;
  tech_id: string;
};

/**
 * Fleiss kappa for a single technique across multiple coders and documents.
 * Treats annotation presence/absence as a binary rating per document per coder.
 */
export function techniqueKappa(
  annotations: BaseAnnotation[],
  techId: string,
  allDocIds: string[],
  allCoderIds: string[],
): number {
  const n = allCoderIds.length;
  if (n < 2 || allDocIds.length === 0) return 0;

  const N = allDocIds.length;

  // For each document, count how many coders applied this technique.
  const ratings = allDocIds.map((docId) => {
    return allCoderIds.filter((coderId) =>
      annotations.some(
        (annotation) =>
          annotation.document_id === docId &&
          annotation.coder_id === coderId &&
          annotation.tech_id === techId,
      ),
    ).length;
  });

  // P_j: proportion assigned to category j (present vs absent).
  const totalRatings = ratings.reduce((sum, rating) => sum + rating, 0);
  const pPresent = totalRatings / (N * n);
  const pAbsent = 1 - pPresent;
  const Pe = pPresent ** 2 + pAbsent ** 2;

  // P_i: observed agreement for each document.
  const Pi = ratings.map((rating) => {
    if (n <= 1) return 1;
    return (
      (rating * (rating - 1) + (n - rating) * (n - rating - 1)) /
      (n * (n - 1))
    );
  });

  const Pbar = Pi.reduce((sum, value) => sum + value, 0) / N;

  if (Pe === 1) return 1;
  return (Pbar - Pe) / (1 - Pe);
}

function disagreementsForTechnique(
  annotations: BaseAnnotation[],
  techId: string,
  allDocIds: string[],
  allCoderIds: string[],
): number {
  const coderCount = allCoderIds.length;
  if (coderCount < 2) return 0;

  let disagreements = 0;

  allDocIds.forEach((docId) => {
    const appliedCount = allCoderIds.filter((coderId) =>
      annotations.some(
        (annotation) =>
          annotation.document_id === docId &&
          annotation.coder_id === coderId &&
          annotation.tech_id === techId,
      ),
    ).length;

    if (appliedCount > 0 && appliedCount < coderCount) {
      disagreements += 1;
    }
  });

  return disagreements;
}

export function interpretKappa(k: number): {
  label: string;
  colour: "red" | "amber" | "green";
  action: string;
} {
  if (k >= 0.9) {
    return { label: "Near-perfect", colour: "green", action: "Done" };
  }
  if (k >= 0.8) {
    return { label: "Strong", colour: "green", action: "Lock the definition" };
  }
  if (k >= 0.7) {
    return { label: "Acceptable", colour: "green", action: "Minor notes only" };
  }
  if (k >= 0.6) {
    return { label: "Moderate", colour: "amber", action: "Clarify decision rules" };
  }
  if (k >= 0.4) {
    return { label: "Fair", colour: "amber", action: "Add boundary examples" };
  }
  return { label: "Poor", colour: "red", action: "Rewrite technique definition" };
}

export function statusFromKappa(k: number): TechniqueStatus {
  if (k >= 0.8) return "LOCKED";
  if (k < 0.7) return "UNDER REVISION";
  return "DRAFT";
}

export function kappaColourClass(colour: "red" | "amber" | "green"): string {
  return {
    red: "text-red-700 bg-red-50 border-red-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200",
    green: "text-green-700 bg-green-50 border-green-200",
  }[colour];
}

/**
 * Calculate kappa for all techniques and return a full summary.
 */
export function calculateFullKappa(
  annotations: BaseAnnotation[],
  allTechIds: string[],
  roundId: string,
): KappaSummary {
  const allDocIds = [...new Set(annotations.map((annotation) => annotation.document_id))];
  const allCoderIds = [...new Set(annotations.map((annotation) => annotation.coder_id))];

  const byTechnique: KappaResult[] = allTechIds.map((techId) => {
    const kappa = techniqueKappa(annotations, techId, allDocIds, allCoderIds);
    const roundedKappa = Math.round(kappa * 1000) / 1000;
    const interpretation = interpretKappa(kappa);
    const note =
      techId.startsWith("P") && roundedKappa >= 0.6 && roundedKappa < 0.7
        ? "Level 3 techniques may plateau around 0.65 due to interpretive complexity."
        : undefined;

    return {
      techId,
      kappa: roundedKappa,
      ...interpretation,
      coderCount: allCoderIds.length,
      docCount: allDocIds.length,
      status: statusFromKappa(roundedKappa),
      disagreements: disagreementsForTechnique(annotations, techId, allDocIds, allCoderIds),
      note,
    };
  });

  const overall =
    byTechnique.length === 0
      ? 0
      : byTechnique.reduce((sum, result) => sum + result.kappa, 0) / byTechnique.length;

  return {
    overall: Math.round(overall * 1000) / 1000,
    byTechnique,
    roundId,
    calculatedAt: new Date().toISOString(),
  };
}

// Backwards-compatible helper used by older stats surfaces.
export function fleissKappa(annotations: BaseAnnotation[]): number {
  const allTechIds = [...new Set(annotations.map((annotation) => annotation.tech_id))];
  if (allTechIds.length === 0) return 0;

  return calculateFullKappa(annotations, allTechIds, "").overall;
}

// Backwards-compatible helper used by existing components.
export function kappaInterpretation(k: number): string {
  return interpretKappa(k).label;
}
