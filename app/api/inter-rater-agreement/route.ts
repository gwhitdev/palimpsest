import { NextRequest, NextResponse } from "next/server";
import {
  extractProjectId,
  isMissingRelationError,
  requireDocumentAccess,
  resolveProjectContext,
  schemaNotReadyResponse,
} from "@/lib/server/projectAuth";

const NONE_LABEL = "__NONE__";
const OVERLAP_LABEL = "__OVERLAP__";

type AnnotationRow = {
  coder_id: string;
  coder_name: string;
  tech_id: string;
  start_offset: number | null;
  end_offset: number | null;
};

type NormalizedAnnotation = {
  coderId: string;
  techId: string;
  start: number;
  end: number;
};

type Segment = {
  start: number;
  end: number;
  length: number;
};

type PairwiseResult = {
  raterAId: string;
  raterAName: string;
  raterBId: string;
  raterBName: string;
  kappa: number | null;
  observedAgreement: number;
  expectedAgreement: number;
  interpretation: string;
};

type RaterSummary = {
  id: string;
  name: string;
  annotationCount: number;
  validAnnotationCount: number;
};

function round(value: number): number {
  return Number(value.toFixed(6));
}

function interpretationForKappa(kappa: number | null): string {
  if (kappa === null || Number.isNaN(kappa)) return "undefined";
  if (kappa < 0) return "poor";
  if (kappa < 0.2) return "slight";
  if (kappa < 0.4) return "fair";
  if (kappa < 0.6) return "moderate";
  if (kappa < 0.8) return "substantial";
  return "almost perfect";
}

function buildSegments(documentLength: number, annotations: NormalizedAnnotation[]): Segment[] {
  const boundaries = new Set<number>([0, documentLength]);
  annotations.forEach((annotation) => {
    boundaries.add(annotation.start);
    boundaries.add(annotation.end);
  });

  const points = [...boundaries].sort((a, b) => a - b);
  const segments: Segment[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    segments.push({ start, end, length: end - start });
  }

  return segments;
}

function labelForSegment(annotations: NormalizedAnnotation[], segment: Segment): string {
  let label: string | null = null;

  for (const annotation of annotations) {
    if (annotation.start < segment.end && annotation.end > segment.start) {
      if (!label) {
        label = annotation.techId;
      } else if (label !== annotation.techId) {
        return OVERLAP_LABEL;
      }
    }
  }

  return label ?? NONE_LABEL;
}

function computePairwise(
  segments: Segment[],
  raterIds: string[],
  raterNames: Map<string, string>,
  annotationsByRater: Map<string, NormalizedAnnotation[]>,
): PairwiseResult[] {
  const results: PairwiseResult[] = [];

  for (let i = 0; i < raterIds.length; i += 1) {
    for (let j = i + 1; j < raterIds.length; j += 1) {
      const raterAId = raterIds[i];
      const raterBId = raterIds[j];
      const raterAAnnotations = annotationsByRater.get(raterAId) ?? [];
      const raterBAnnotations = annotationsByRater.get(raterBId) ?? [];

      let totalWeight = 0;
      let agreeWeight = 0;
      const rowTotals = new Map<string, number>();
      const columnTotals = new Map<string, number>();
      const categories = new Set<string>();

      segments.forEach((segment) => {
        const labelA = labelForSegment(raterAAnnotations, segment);
        const labelB = labelForSegment(raterBAnnotations, segment);

        categories.add(labelA);
        categories.add(labelB);

        totalWeight += segment.length;
        if (labelA === labelB) agreeWeight += segment.length;

        rowTotals.set(labelA, (rowTotals.get(labelA) ?? 0) + segment.length);
        columnTotals.set(labelB, (columnTotals.get(labelB) ?? 0) + segment.length);
      });

      const observedAgreement = totalWeight > 0 ? agreeWeight / totalWeight : 0;
      let expectedAgreement = 0;

      if (totalWeight > 0) {
        categories.forEach((category) => {
          const row = (rowTotals.get(category) ?? 0) / totalWeight;
          const col = (columnTotals.get(category) ?? 0) / totalWeight;
          expectedAgreement += row * col;
        });
      }

      const denominator = 1 - expectedAgreement;
      const kappa =
        totalWeight === 0 || Math.abs(denominator) < Number.EPSILON
          ? null
          : (observedAgreement - expectedAgreement) / denominator;

      results.push({
        raterAId,
        raterAName: raterNames.get(raterAId) ?? "Unknown",
        raterBId,
        raterBName: raterNames.get(raterBId) ?? "Unknown",
        kappa: kappa === null ? null : round(kappa),
        observedAgreement: round(observedAgreement),
        expectedAgreement: round(expectedAgreement),
        interpretation: interpretationForKappa(kappa),
      });
    }
  }

  return results;
}

function computeFleiss(
  segments: Segment[],
  raterIds: string[],
  annotationsByRater: Map<string, NormalizedAnnotation[]>,
) {
  const raterCount = raterIds.length;
  if (raterCount < 2 || segments.length === 0) {
    return {
      kappa: null as number | null,
      observedAgreement: 0,
      expectedAgreement: 0,
      interpretation: "undefined",
      categories: [] as string[],
    };
  }

  let totalWeight = 0;
  let weightedObservedAgreement = 0;
  const weightedCategoryCounts = new Map<string, number>();

  segments.forEach((segment) => {
    const counts = new Map<string, number>();

    raterIds.forEach((raterId) => {
      const label = labelForSegment(annotationsByRater.get(raterId) ?? [], segment);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    let numerator = 0;
    counts.forEach((count) => {
      numerator += count * count;
    });

    const observedBySegment = (numerator - raterCount) / (raterCount * (raterCount - 1));
    weightedObservedAgreement += segment.length * observedBySegment;
    totalWeight += segment.length;

    counts.forEach((count, category) => {
      weightedCategoryCounts.set(
        category,
        (weightedCategoryCounts.get(category) ?? 0) + segment.length * count,
      );
    });
  });

  const observedAgreement = totalWeight > 0 ? weightedObservedAgreement / totalWeight : 0;
  const denominatorBase = totalWeight * raterCount;

  let expectedAgreement = 0;
  weightedCategoryCounts.forEach((weightedCount) => {
    const proportion = denominatorBase > 0 ? weightedCount / denominatorBase : 0;
    expectedAgreement += proportion * proportion;
  });

  const denominator = 1 - expectedAgreement;
  const kappa =
    totalWeight === 0 || Math.abs(denominator) < Number.EPSILON
      ? null
      : (observedAgreement - expectedAgreement) / denominator;

  return {
    kappa: kappa === null ? null : round(kappa),
    observedAgreement: round(observedAgreement),
    expectedAgreement: round(expectedAgreement),
    interpretation: interpretationForKappa(kappa),
    categories: [...weightedCategoryCounts.keys()],
  };
}

export async function GET(request: NextRequest) {
  const auth = await resolveProjectContext(extractProjectId(request), "view_documents");
  if (!auth.ok) return auth.response;

  const { supabase, projectId } = auth.context;
  const documentId = request.nextUrl.searchParams.get("docId");

  if (!documentId) {
    return NextResponse.json({ error: "docId is required." }, { status: 400 });
  }

  const access = await requireDocumentAccess(auth.context, documentId);
  if (!access.ok) return access.response;

  const [documentResult, annotationsResult] = await Promise.all([
    supabase
      .from("documents")
      .select("id, content")
      .eq("project_id", projectId)
      .eq("id", documentId)
      .maybeSingle(),
    supabase
      .from("annotations")
      .select("coder_id, coder_name, tech_id, start_offset, end_offset")
      .eq("project_id", projectId)
      .eq("document_id", documentId),
  ]);

  if (isMissingRelationError(documentResult.error) || isMissingRelationError(annotationsResult.error)) {
    return schemaNotReadyResponse();
  }

  if (documentResult.error) {
    return NextResponse.json({ error: documentResult.error.message }, { status: 500 });
  }

  if (annotationsResult.error) {
    return NextResponse.json({ error: annotationsResult.error.message }, { status: 500 });
  }

  if (!documentResult.data) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const documentLength = documentResult.data.content?.length ?? 0;
  const rawAnnotations = (annotationsResult.data ?? []) as AnnotationRow[];

  const annotationCountByRater = new Map<string, number>();
  const validAnnotationCountByRater = new Map<string, number>();
  const raterNames = new Map<string, string>();
  const normalized: NormalizedAnnotation[] = [];
  let invalidAnnotationCount = 0;

  rawAnnotations.forEach((annotation) => {
    annotationCountByRater.set(
      annotation.coder_id,
      (annotationCountByRater.get(annotation.coder_id) ?? 0) + 1,
    );

    if (!raterNames.has(annotation.coder_id)) {
      raterNames.set(annotation.coder_id, annotation.coder_name);
    }

    const start = annotation.start_offset;
    const end = annotation.end_offset;
    const validOffsets =
      typeof start === "number" &&
      typeof end === "number" &&
      start >= 0 &&
      end > start &&
      end <= documentLength;

    if (!validOffsets) {
      invalidAnnotationCount += 1;
      return;
    }

    normalized.push({
      coderId: annotation.coder_id,
      techId: annotation.tech_id,
      start,
      end,
    });

    validAnnotationCountByRater.set(
      annotation.coder_id,
      (validAnnotationCountByRater.get(annotation.coder_id) ?? 0) + 1,
    );
  });

  const annotationsByRater = new Map<string, NormalizedAnnotation[]>();
  normalized.forEach((annotation) => {
    const current = annotationsByRater.get(annotation.coderId) ?? [];
    current.push(annotation);
    annotationsByRater.set(annotation.coderId, current);
  });

  const raterIds = [...annotationsByRater.keys()];
  const segments = buildSegments(documentLength, normalized);
  const pairwise = computePairwise(segments, raterIds, raterNames, annotationsByRater);
  const overall = computeFleiss(segments, raterIds, annotationsByRater);

  const raters: RaterSummary[] = [...annotationCountByRater.entries()].map(([id, annotationCount]) => ({
    id,
    name: raterNames.get(id) ?? "Unknown",
    annotationCount,
    validAnnotationCount: validAnnotationCountByRater.get(id) ?? 0,
  }));

  raters.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    projectId,
    documentId,
    method: "fleiss_kappa_with_pairwise_cohen",
    labelSpace: [NONE_LABEL, OVERLAP_LABEL, "tech_id values"],
    raters,
    raterCount: raterIds.length,
    insufficientRaters: raterIds.length < 2,
    stats: {
      documentLength,
      segmentCount: segments.length,
      annotationCount: rawAnnotations.length,
      validAnnotationCount: normalized.length,
      invalidAnnotationCount,
    },
    overall,
    pairwise,
  });
}
