"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import AISuggestionsDrawer from "@/components/annotation/AISuggestionsDrawer";
import AnnotationList from "@/components/annotation/AnnotationList";
import AnnotationEditorModal from "@/components/annotation/AnnotationEditorModal";
import CommentsDrawer from "@/components/annotation/CommentsDrawer";
import SelectionPopup from "../../../../components/annotation/SelectionPopup";
import TechniquePanel from "@/components/annotation/TechniquePanel";
import TextAnnotator from "@/components/annotation/TextAnnotator";
import { parseResponseJson } from "@/lib/http";
import { getActiveProjectId, setActiveProjectId, withProjectQuery } from "@/lib/projectClient";
import { createClient } from "@/lib/supabase/client";
import { Annotation, AnnotationCodeChange, AnnotatorUser, Document, DocumentComment } from "@/lib/types";
import { useAnnotationStore } from "@/store/annotationStore";

type SelectionState = {
  text: string;
  position: { x: number; y: number };
  start: number;
  end: number;
};

type ViewerRole = "owner" | "coder";

type DocumentContextResponse = {
  document?: Document;
  accessUsers?: AnnotatorUser[];
  viewerRole?: ViewerRole;
  otherAnnotationsVisibleToCoders?: boolean;
  otherCodersVisibleToCoders?: boolean;
  canEditSource?: boolean;
  canAmendDocument?: boolean;
  error?: string;
};

type AnnotationChangeHistoryResponse = {
  changes?: AnnotationCodeChange[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type QuoteDraft = {
  text: string;
  start: number;
  end: number;
};

type AnnotationViewMode = "all" | "user" | "merged";

type AnnotationInsightsResponse = {
  mergedAnnotationIds?: string[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type InterRaterOverall = {
  kappa: number | null;
  observedAgreement: number;
  expectedAgreement: number;
  interpretation: string;
};

type InterRaterPairwise = {
  raterAName: string;
  raterBName: string;
  kappa: number | null;
  observedAgreement: number;
  interpretation: string;
};

type InterRaterAgreementResponse = {
  overall?: InterRaterOverall;
  pairwise?: InterRaterPairwise[];
  raterCount?: number;
  insufficientRaters?: boolean;
  statsHidden?: boolean;
  stats?: {
    invalidAnnotationCount?: number;
  };
  error?: string;
};

export default function AnnotatePage() {
  const { docId } = useParams<{ docId: string }>();
  const [document, setDocument] = useState<Document | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [pendingCommentQuote, setPendingCommentQuote] = useState<QuoteDraft | null>(null);
  const [coderName, setCoderName] = useState("Coder");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<ViewerRole | null>(null);
  const [otherAnnotationsVisibleToCoders, setOtherAnnotationsVisibleToCoders] = useState(true);
  const [otherCodersVisibleToCoders, setOtherCodersVisibleToCoders] = useState(true);
  const [accessUsers, setAccessUsers] = useState<AnnotatorUser[]>([]);
  const [canEditSource, setCanEditSource] = useState(false);
  const [canAmendDocument, setCanAmendDocument] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [contentDraft, setContentDraft] = useState("");
  const [amendmentNoteDraft, setAmendmentNoteDraft] = useState("");
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [isAppSuperAdmin, setIsAppSuperAdmin] = useState(false);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [isCommentsDrawerOpen, setIsCommentsDrawerOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<AnnotationViewMode>("all");
  const [selectedAnnotatorId, setSelectedAnnotatorId] = useState("all");
  const [mergedAnnotationIds, setMergedAnnotationIds] = useState<Set<string>>(new Set());
  const [interRaterOverall, setInterRaterOverall] = useState<InterRaterOverall | null>(null);
  const [interRaterPairwise, setInterRaterPairwise] = useState<InterRaterPairwise[]>([]);
  const [interRaterInsufficient, setInterRaterInsufficient] = useState(false);
  const [interRaterRaterCount, setInterRaterRaterCount] = useState(0);
  const [interRaterInvalidAnnotationCount, setInterRaterInvalidAnnotationCount] = useState(0);
  const [interRaterHiddenReason, setInterRaterHiddenReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [annotationChangesById, setAnnotationChangesById] = useState<Record<string, AnnotationCodeChange[]>>({});

  const {
    annotations,
    aiSuggestions,
    isSuggestionsDrawerOpen,
    addAnnotation,
    removeAnnotation,
    setAnnotations,
    setHoveredAnnotationId,
    setSuggestionContext,
    setSuggestionsDrawerOpen,
  } = useAnnotationStore();
  const supabase = createClient();

  const loadDocumentContext = useCallback(async () => {
    if (!docId || !projectId) return;

    const response = await fetch(withProjectQuery(`/api/documents/${docId}`, projectId));
    const payload = await parseResponseJson<DocumentContextResponse>(response, {});

    if (!response.ok || !payload.document) {
      throw new Error(payload.error ?? "Unable to load document.");
    }

    setDocument(payload.document);
    setAccessUsers(payload.accessUsers ?? []);
    setViewerRole(payload.viewerRole ?? null);
    setOtherAnnotationsVisibleToCoders(payload.otherAnnotationsVisibleToCoders !== false);
    setOtherCodersVisibleToCoders(payload.otherCodersVisibleToCoders !== false);
    setCanEditSource(Boolean(payload.canEditSource));
    setCanAmendDocument(Boolean(payload.canAmendDocument));
    setSourceDraft(payload.document.source ?? "");
    setContentDraft(payload.document.content ?? "");
    setAmendmentNoteDraft(payload.document.amendment_note ?? "");
  }, [docId, projectId]);

  const loadAnnotationChanges = useCallback(async () => {
    if (!docId || !projectId) return;

    const response = await fetch(withProjectQuery(`/api/annotation-change-history?docId=${docId}`, projectId));
    const payload = await parseResponseJson<AnnotationChangeHistoryResponse>(response, {});

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load annotation change history.");
    }

    const byId: Record<string, AnnotationCodeChange[]> = {};
    (payload.changes ?? []).forEach((change) => {
      if (!byId[change.annotation_id]) {
        byId[change.annotation_id] = [];
      }
      byId[change.annotation_id].push(change);
    });

    // Ensure per-annotation order is newest-first.
    Object.values(byId).forEach((changes) => {
      changes.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
    });

    setAnnotationChangesById(byId);
  }, [docId, projectId]);

  const loadAnnotations = useCallback(async () => {
    if (!docId || !projectId) return;

    const response = await fetch(withProjectQuery(`/api/annotate?docId=${docId}`, projectId));
    const data = await parseResponseJson<{ annotations?: Annotation[]; error?: string }>(response, {});

    if (!response.ok) {
      throw new Error(data.error ?? "Unable to load annotations.");
    }

    setAnnotations(data.annotations ?? []);
  }, [docId, projectId, setAnnotations]);

  const loadComments = useCallback(async () => {
    if (!docId || !projectId) return;

    const response = await fetch(withProjectQuery(`/api/comments?docId=${docId}`, projectId));
    const data = await parseResponseJson<{
      comments?: DocumentComment[];
      setupRequired?: boolean;
      setupHint?: string;
      error?: string;
    }>(response, {});

    if (!response.ok) {
      if (data.setupRequired) {
        setError(data.setupHint ?? data.error ?? "Comments table setup required.");
        setComments([]);
        return;
      }
      throw new Error(data.error ?? "Unable to load comments.");
    }

    setComments(data.comments ?? []);
  }, [docId, projectId]);

  const applyInsights = useCallback((payload: AnnotationInsightsResponse) => {
    setMergedAnnotationIds(new Set(payload.mergedAnnotationIds ?? []));
  }, []);

  const loadInsights = useCallback(async () => {
    if (!docId || !projectId) return;

    const response = await fetch(withProjectQuery(`/api/annotation-insights?docId=${docId}`, projectId));
    const payload = await parseResponseJson<AnnotationInsightsResponse>(response, {});

    if (!response.ok) {
      if (payload.setupRequired) {
        setError(payload.setupHint ?? payload.error ?? "Annotation insights setup required.");
        applyInsights({});
        return;
      }

      throw new Error(payload.error ?? "Unable to load annotation insights.");
    }

    applyInsights(payload);
  }, [applyInsights, docId, projectId]);

  const loadInterRaterAgreement = useCallback(async () => {
    if (!docId || !projectId) return;

    const response = await fetch(withProjectQuery(`/api/inter-rater-agreement?docId=${docId}`, projectId));
    const payload = await parseResponseJson<InterRaterAgreementResponse>(response, {});

    if (!response.ok) {
      if (response.status === 403) {
        setInterRaterOverall(null);
        setInterRaterPairwise([]);
        setInterRaterInsufficient(false);
        setInterRaterRaterCount(0);
        setInterRaterInvalidAnnotationCount(0);
        setInterRaterHiddenReason(payload.error ?? "Project stats are hidden from coders.");
        return;
      }

      throw new Error(payload.error ?? "Unable to load inter-rater agreement.");
    }

    setInterRaterHiddenReason(null);
    setInterRaterOverall(payload.overall ?? null);
    setInterRaterPairwise(payload.pairwise ?? []);
    setInterRaterInsufficient(Boolean(payload.insufficientRaters));
    setInterRaterRaterCount(payload.raterCount ?? 0);
    setInterRaterInvalidAnnotationCount(payload.stats?.invalidAnnotationCount ?? 0);
  }, [docId, projectId]);

  useEffect(() => {
    const queryProjectId =
      typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("projectId");
    const preferredProjectId = queryProjectId || getActiveProjectId();
    const url = withProjectQuery("/api/projects", preferredProjectId);

    (async () => {
      try {
        const response = await fetch(url);
        const payload = await parseResponseJson<{ error?: string; currentProjectId?: string }>(response, {});

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to resolve project context.");
        }

        if (!payload.currentProjectId) {
          throw new Error("No active project found.");
        }

        setProjectId(payload.currentProjectId);
        setActiveProjectId(payload.currentProjectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to resolve project context.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!docId || !projectId) return;

    (async () => {
      try {
        await loadDocumentContext();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load document.");
        setDocument(null);
      }
    })();

    (async () => {
      try {
        await loadAnnotations();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load annotations.");
      }
    })();

    (async () => {
      try {
        await loadComments();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load comments.");
      }
    })();

    (async () => {
      try {
        await loadInsights();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load annotation insights.");
      }
    })();

    (async () => {
      try {
        await loadInterRaterAgreement();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load inter-rater agreement.");
      }
    })();

    (async () => {
      try {
        await loadAnnotationChanges();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load annotation change history.");
      }
    })();

    supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) {
        setCurrentUserId(null);
        return;
      }

      setCurrentUserId(user.id);

      const fallbackName = user.email?.split("@")[0] ?? "Coder";
      const { data: coder } = await supabase
        .from("coders")
        .select("display_name, role")
        .eq("id", user.id)
        .single();

      setCoderName(coder?.display_name ?? fallbackName);
      setIsAppSuperAdmin(coder?.role === "admin");
    });
  }, [
    docId,
    loadAnnotationChanges,
    loadAnnotations,
    loadComments,
    loadDocumentContext,
    loadInsights,
    loadInterRaterAgreement,
    projectId,
    supabase,
  ]);

  useEffect(() => {
    if (!docId || !projectId) return;

    setSuggestionContext(`${projectId}:${docId}`);
    setHoveredAnnotationId(null);

    return () => {
      setHoveredAnnotationId(null);
    };
  }, [docId, projectId, setHoveredAnnotationId, setSuggestionContext]);

  useEffect(() => {
    if (!docId || !projectId) return;

    const channel = supabase
      .channel(`annotations-${projectId}-${docId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "annotations",
          filter: `document_id=eq.${docId}`,
        },
        ({ new: row }) => {
          addAnnotation(row as Annotation);
          void loadInterRaterAgreement();
          void loadAnnotationChanges();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "annotations",
          filter: `document_id=eq.${docId}`,
        },
        ({ old: row }) => {
          removeAnnotation((row as { id: string }).id);
          void loadInterRaterAgreement();
          void loadAnnotationChanges();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [addAnnotation, docId, loadAnnotationChanges, loadInterRaterAgreement, projectId, removeAnnotation, supabase]);

  useEffect(() => {
    if (!docId || !projectId) return;

    const channel = supabase
      .channel(`annotation-insights-${projectId}-${docId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "merged_annotations",
          filter: `document_id=eq.${docId}`,
        },
        () => {
          void loadInsights();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [docId, loadInsights, projectId, supabase]);

  useEffect(() => {
    if (!docId || !projectId) return;

    const channel = supabase
      .channel(`comments-${projectId}-${docId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "document_comments",
          filter: `document_id=eq.${docId}`,
        },
        ({ new: row }) => {
          const newComment = row as DocumentComment;
          setComments((current) => {
            if (current.some((comment) => comment.id === newComment.id)) return current;
            return [...current, newComment];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [docId, projectId, supabase]);

  const isOwner = viewerRole === "owner";
  const isCoderAnnotationViewRestricted =
    viewerRole === "coder" && !otherAnnotationsVisibleToCoders;

  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 4500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  useEffect(() => {
    if (!isCoderAnnotationViewRestricted || !currentUserId) return;
    setViewMode("user");
    setSelectedAnnotatorId(currentUserId);
  }, [currentUserId, isCoderAnnotationViewRestricted]);

  const handleSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !document) return;

    const text = sel.toString().trim();
    if (text.length < 3) return;

    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const start = document.content.indexOf(text);
    const end = start === -1 ? -1 : start + text.length;

    setSelection({
      text,
      position: { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY + 8 },
      start,
      end,
    });
  };

  const handleAnnotate = async (techIds: string[]) => {
    if (!selection || !docId || !projectId) return;
    const uniqueTechIds = [...new Set(techIds.filter((id) => id.trim().length > 0))];
    if (uniqueTechIds.length === 0) return;

    if (selection.start < 0 || selection.end <= selection.start) {
      setError("Unable to map this selection to the current document. Please try again.");
      return;
    }

    try {
      const response = await fetch("/api/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          document_id: docId,
          tech_ids: uniqueTechIds,
          quoted_text: selection.text,
          coder_name: coderName,
          is_ai: false,
          accepted: true,
          start_offset: selection.start,
          end_offset: selection.end,
        }),
      });

      const payload = await parseResponseJson<{
        annotations?: Annotation[];
        replacedAnnotationCount?: number;
        error?: string;
      }>(response, {});

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save annotations.");
      }

      const createdCount = payload.annotations?.length ?? uniqueTechIds.length;
      const replacedCount = payload.replacedAnnotationCount ?? 0;
      const createdLabel = `${createdCount} annotation${createdCount === 1 ? "" : "s"}`;
      const replacedLabel = `${replacedCount} overlapping annotation${replacedCount === 1 ? "" : "s"}`;

      setNotice(
        replacedCount > 0
          ? `Saved ${createdLabel} and replaced ${replacedLabel}.`
          : `Saved ${createdLabel}.`,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save annotations.");
    } finally {
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleCommentFromSelection = () => {
    if (!selection) return;

    setPendingCommentQuote({
      text: selection.text,
      start: selection.start,
      end: selection.end,
    });
    setIsCommentsDrawerOpen(true);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleCreateComment = async (input: { body: string; quote: QuoteDraft | null }) => {
    if (!projectId || !docId) {
      throw new Error("Document context is not ready.");
    }

    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        documentId: docId,
        body: input.body,
        quotedText: input.quote?.text ?? null,
        startOffset: input.quote?.start ?? null,
        endOffset: input.quote?.end ?? null,
      }),
    });

    const payload = await parseResponseJson<{ comment?: DocumentComment; error?: string }>(response, {});
    if (!response.ok || !payload.comment) {
      throw new Error(payload.error ?? "Failed to add comment.");
    }

    setComments((current) => [...current, payload.comment as DocumentComment]);
  };

  const handleReply = async (input: { parentId: string; body: string }) => {
    if (!projectId || !docId) {
      throw new Error("Document context is not ready.");
    }

    const response = await fetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        documentId: docId,
        parentId: input.parentId,
        body: input.body,
      }),
    });

    const payload = await parseResponseJson<{ comment?: DocumentComment; error?: string }>(response, {});
    if (!response.ok || !payload.comment) {
      throw new Error(payload.error ?? "Failed to add reply.");
    }

    setComments((current) => [...current, payload.comment as DocumentComment]);
  };

  const handleSaveSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !docId) return;

    setIsSavingSource(true);
    setError(null);

    try {
      const response = await fetch(withProjectQuery(`/api/documents/${docId}`, projectId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceDraft }),
      });

      const payload = await parseResponseJson<{ document?: Document; error?: string }>(response, {});
      if (!response.ok || !payload.document) {
        throw new Error(payload.error ?? "Failed to update source.");
      }

      setDocument(payload.document);
      setSourceDraft(payload.document.source ?? "");
      setNotice(payload.document.source ? "Source updated." : "Source removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update source.");
    } finally {
      setIsSavingSource(false);
    }
  };

  const handleSaveAmendment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !docId) return;

    setIsSavingContent(true);
    setError(null);

    try {
      const response = await fetch(withProjectQuery(`/api/documents/${docId}`, projectId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: contentDraft,
          amendmentNote: amendmentNoteDraft,
        }),
      });

      const payload = await parseResponseJson<{
        document?: Document;
        amended?: boolean;
        contentChanged?: boolean;
        error?: string;
      }>(response, {});

      if (!response.ok || !payload.document) {
        throw new Error(payload.error ?? "Failed to amend document content.");
      }

      setDocument(payload.document);
      setContentDraft(payload.document.content ?? "");
      setAmendmentNoteDraft(payload.document.amendment_note ?? "");
      setNotice(
        payload.contentChanged
          ? "Document amended and notice published to all users."
          : "No content changes detected.",
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to amend document content.");
    } finally {
      setIsSavingContent(false);
    }
  };

  const openAnnotationEditor = (annotationId: string) => {
    setEditingAnnotationId(annotationId);
  };

  const handleDeleteAnnotation = async (annotationId: string) => {
    if (!projectId) {
      throw new Error("Project context is not ready.");
    }

    const annotationToRestore = annotations.find((annotation) => annotation.id === annotationId);
    removeAnnotation(annotationId);

    const response = await fetch("/api/annotate", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: annotationId, projectId }),
    });

    const payload = await parseResponseJson<{ error?: string }>(response, {});
    if (!response.ok) {
      if (annotationToRestore) {
        addAnnotation(annotationToRestore);
      }
      throw new Error(payload.error ?? "Failed to remove annotation.");
    }

    if (viewerRole === "owner") {
      await loadInterRaterAgreement();
    }
    await loadAnnotationChanges();

    setNotice("Annotation deleted.");
    setError(null);
  };

  const handleEditAnnotation = async (annotationId: string, techId: string) => {
    if (!projectId) {
      throw new Error("Project context is not ready.");
    }

    const response = await fetch("/api/annotate", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: annotationId,
        projectId,
        tech_id: techId,
      }),
    });

    const payload = await parseResponseJson<{
      annotation?: Annotation | null;
      previousTechId?: string;
      updatedTechId?: string;
      changed?: boolean;
      error?: string;
    }>(response, {});

    if (!response.ok || !payload.annotation) {
      throw new Error(payload.error ?? "Failed to update annotation.");
    }

    await loadAnnotations();
    await loadAnnotationChanges();
    if (viewerRole === "owner") {
      await loadInterRaterAgreement();
    }

    const previousTechId = payload.previousTechId ?? payload.annotation.tech_id;
    const updatedTechId = payload.updatedTechId ?? payload.annotation.tech_id;
    if (payload.changed === false) {
      setNotice(`Annotation unchanged (${updatedTechId}).`);
    } else {
      setNotice(`Annotation updated: ${previousTechId} -> ${updatedTechId}.`);
    }
    setError(null);
  };

  const handleRemove = async (id: string) => {
    try {
      await handleDeleteAnnotation(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove annotation.");
    }
  };

  const handleToggleMerged = async (annotationId: string, keep: boolean) => {
    if (!projectId) return;

    try {
      const response = await fetch("/api/annotation-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          annotationId,
          keep,
        }),
      });

      const payload = await parseResponseJson<AnnotationInsightsResponse>(response, {});
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update merged set.");
      }

      applyInsights(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update merged set.");
    }
  };

  const handleAcceptSuggestion = async (suggestion: { techId: string; text: string }) => {
    if (!projectId || !docId || !document) {
      throw new Error("Document context is not ready.");
    }

    const quotedText = suggestion.text.trim();
    if (!quotedText) {
      throw new Error("Suggestion text is empty.");
    }

    const start = document.content.indexOf(quotedText);
    if (start === -1) {
      throw new Error("Suggested quote was not found in the document. Please annotate it manually.");
    }

    const end = start + quotedText.length;
    const response = await fetch("/api/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        document_id: docId,
        tech_id: suggestion.techId,
        quoted_text: quotedText,
        coder_name: coderName,
        is_ai: true,
        accepted: true,
        start_offset: start,
        end_offset: end,
      }),
    });

    const payload = await parseResponseJson<{ error?: string }>(response, {});
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to save accepted suggestion.");
    }
  };

  const visibleAnnotations = useMemo(() => {
    if (isCoderAnnotationViewRestricted && currentUserId) {
      return annotations.filter((annotation) => annotation.coder_id === currentUserId);
    }

    if (viewMode === "user" && selectedAnnotatorId !== "all") {
      return annotations.filter((annotation) => annotation.coder_id === selectedAnnotatorId);
    }

    if (viewMode === "merged") {
      return annotations.filter((annotation) => mergedAnnotationIds.has(annotation.id));
    }

    return annotations;
  }, [annotations, currentUserId, isCoderAnnotationViewRestricted, mergedAnnotationIds, selectedAnnotatorId, viewMode]);

  const canManageMergedSet =
    !!currentUserId && accessUsers.some((user) => user.id === currentUserId && user.role === "owner");

  const editingAnnotation = useMemo(() => {
    if (!editingAnnotationId) return null;
    return annotations.find((annotation) => annotation.id === editingAnnotationId) ?? null;
  }, [annotations, editingAnnotationId]);

  const canEditSelectedAnnotation =
    !!editingAnnotation && !!currentUserId &&
    (editingAnnotation.coder_id === currentUserId || viewerRole === "owner");

  return (
    <div className="relative grid h-[calc(100vh-65px)] grid-cols-[320px_1fr_320px] overflow-hidden">
      <aside className="overflow-y-auto border-r p-4">
        <AnnotationList
          annotations={annotations}
          accessUsers={accessUsers}
          currentUserId={currentUserId}
          viewerRole={viewerRole}
          documentLength={document?.content.length}
          restrictHistoryToCurrentUser={viewerRole === "coder" && !otherAnnotationsVisibleToCoders}
          showAnnotationFilters={!isCoderAnnotationViewRestricted}
          viewMode={viewMode}
          selectedAnnotatorId={selectedAnnotatorId}
          onChangeViewMode={setViewMode}
          onChangeSelectedAnnotatorId={setSelectedAnnotatorId}
          mergedAnnotationIds={mergedAnnotationIds}
          canManageMergedSet={canManageMergedSet}
          interRaterOverall={interRaterOverall}
          interRaterPairwise={interRaterPairwise}
          interRaterInsufficient={interRaterInsufficient}
          interRaterRaterCount={interRaterRaterCount}
          interRaterInvalidAnnotationCount={interRaterInvalidAnnotationCount}
          interRaterHiddenReason={interRaterHiddenReason}
          annotationChangesById={annotationChangesById}
          onOpenAnnotationEditor={openAnnotationEditor}
          onToggleMerged={handleToggleMerged}
        />
      </aside>

      <main className="overflow-y-auto p-6" onMouseUp={handleSelection}>
        {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {notice && <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

        {document ? (
          <>
            <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
              <h1 className="text-lg font-semibold">{document.title}</h1>
              <p className="mt-1 text-xs text-gray-500">Document ID: {document.id}</p>

              {document.source ? (
                <p className="mt-2 text-sm text-gray-700">Source: {document.source}</p>
              ) : (
                <p className="mt-2 text-sm text-amber-700">Source: not provided yet</p>
              )}

              {document.amended_at && (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="font-semibold">Document amended</p>
                  <p className="mt-1">
                    {new Date(document.amended_at).toLocaleString()}
                    {document.amended_by_name ? ` by ${document.amended_by_name}` : ""}
                  </p>
                  {document.amendment_note && (
                    <p className="mt-1">Note: {document.amendment_note}</p>
                  )}
                </div>
              )}

              {canEditSource && (
                <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={handleSaveSource}>
                  <input
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    onChange={(event) => setSourceDraft(event.target.value)}
                    placeholder="Add or update source"
                    value={sourceDraft}
                  />
                  <button
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 disabled:opacity-50"
                    disabled={isSavingSource}
                    type="submit"
                  >
                    {isSavingSource ? "Saving..." : document.source ? "Update Source" : "Add Source"}
                  </button>
                </form>
              )}

              {canAmendDocument && (
                <form className="mt-4 space-y-2" onSubmit={handleSaveAmendment}>
                  <label className="block text-xs font-semibold text-gray-800" htmlFor="document-amend-content">
                    Amend document content
                  </label>
                  <textarea
                    id="document-amend-content"
                    className="min-h-40 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    onChange={(event) => setContentDraft(event.target.value)}
                    value={contentDraft}
                  />
                  <input
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    onChange={(event) => setAmendmentNoteDraft(event.target.value)}
                    placeholder="Optional amendment note shown to all users"
                    value={amendmentNoteDraft}
                  />
                  <button
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 disabled:opacity-50"
                    disabled={isSavingContent}
                    type="submit"
                  >
                    {isSavingContent ? "Saving amendment..." : "Save Amendment"}
                  </button>
                </form>
              )}
            </section>

            <TextAnnotator
              content={document.content}
              annotations={visibleAnnotations}
              onAnnotate={() => undefined}
              onSelectAnnotation={openAnnotationEditor}
              onRemove={handleRemove}
              currentUserId={currentUserId}
            />
          </>
        ) : (
          <p className="text-sm text-gray-600">Loading document...</p>
        )}

        <SelectionPopup
          position={selection?.position ?? null}
          selectedText={selection?.text ?? ""}
          onSelect={handleAnnotate}
          onComment={handleCommentFromSelection}
          onDismiss={() => setSelection(null)}
        />
      </main>

      <aside className="overflow-y-auto border-l">
        <div className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 p-3 backdrop-blur-sm">
          <div className={`grid gap-2 ${isOwner ? "grid-cols-2" : "grid-cols-1"}`}>
            {isOwner && (
              <button
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900"
                onClick={() => setSuggestionsDrawerOpen(!isSuggestionsDrawerOpen)}
                type="button"
              >
                {isSuggestionsDrawerOpen ? "Hide AI Suggestions" : `Show AI Suggestions (${aiSuggestions.length})`}
              </button>
            )}
            <button
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900"
              onClick={() => setIsCommentsDrawerOpen(!isCommentsDrawerOpen)}
              type="button"
            >
              {isCommentsDrawerOpen ? "Hide Comments" : `Show Comments (${comments.length})`}
            </button>
          </div>
        </div>
        <TechniquePanel
          docId={docId}
          docContent={document?.content}
          projectId={projectId}
          canUseAISuggestions={isOwner}
          canEditTaxonomyPractice={isOwner || isAppSuperAdmin}
        />
      </aside>

      {isOwner && (
        <AISuggestionsDrawer onAcceptSuggestion={handleAcceptSuggestion} showLaunchButton={false} />
      )}
      <CommentsDrawer
        comments={comments}
        isOpen={isCommentsDrawerOpen}
        showLaunchButton={false}
        pendingQuote={pendingCommentQuote}
        onOpen={() => setIsCommentsDrawerOpen(true)}
        onClose={() => setIsCommentsDrawerOpen(false)}
        onClearPendingQuote={() => setPendingCommentQuote(null)}
        onCreateComment={handleCreateComment}
        onReply={handleReply}
      />
      <AnnotationEditorModal
        annotation={editingAnnotation}
        canEdit={canEditSelectedAnnotation}
        onClose={() => setEditingAnnotationId(null)}
        onSave={handleEditAnnotation}
        onDelete={handleDeleteAnnotation}
      />
    </div>
  );
}
