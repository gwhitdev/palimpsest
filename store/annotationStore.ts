import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { AISuggestion, Annotation } from "@/lib/types";

interface AnnotationStore {
  annotations: Annotation[];
  aiSuggestions: AISuggestion[];
  suggestionsByContext: Record<string, AISuggestion[]>;
  suggestionContextKey: string | null;
  activeDocId: string | null;
  hoveredAnnotationId: string | null;
  isLoadingAI: boolean;
  isSuggestionsDrawerOpen: boolean;
  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  setSuggestionContext: (contextKey: string) => void;
  setAISuggestions: (suggestions: AISuggestion[]) => void;
  acceptSuggestion: (index: number) => void;
  dismissSuggestion: (index: number) => void;
  setActiveDocId: (id: string) => void;
  setHoveredAnnotationId: (id: string | null) => void;
  setLoadingAI: (loading: boolean) => void;
  setSuggestionsDrawerOpen: (open: boolean) => void;
}

export const useAnnotationStore = create<AnnotationStore>()(
  persist(
    (set, get) => ({
      annotations: [],
      aiSuggestions: [],
      suggestionsByContext: {},
      suggestionContextKey: null,
      activeDocId: null,
      hoveredAnnotationId: null,
      isLoadingAI: false,
      isSuggestionsDrawerOpen: true,
      setAnnotations: (annotations) => set({ annotations }),
      addAnnotation: (annotation) =>
        set((state) => ({ annotations: [...state.annotations, annotation] })),
      removeAnnotation: (id) =>
        set((state) => ({
          annotations: state.annotations.filter((annotation) => annotation.id !== id),
        })),
      setSuggestionContext: (suggestionContextKey) =>
        set((state) => ({
          suggestionContextKey,
          aiSuggestions: state.suggestionsByContext[suggestionContextKey] ?? [],
        })),
      setAISuggestions: (aiSuggestions) =>
        set((state) => {
          if (!state.suggestionContextKey) {
            return { aiSuggestions };
          }

          return {
            aiSuggestions,
            suggestionsByContext: {
              ...state.suggestionsByContext,
              [state.suggestionContextKey]: aiSuggestions,
            },
          };
        }),
      acceptSuggestion: (index) => {
        const next = get().aiSuggestions.filter((_, idx) => idx !== index);
        get().setAISuggestions(next);
      },
      dismissSuggestion: (index) => {
        const next = get().aiSuggestions.filter((_, idx) => idx !== index);
        get().setAISuggestions(next);
      },
      setActiveDocId: (activeDocId) => set({ activeDocId }),
      setHoveredAnnotationId: (hoveredAnnotationId) => set({ hoveredAnnotationId }),
      setLoadingAI: (isLoadingAI) => set({ isLoadingAI }),
      setSuggestionsDrawerOpen: (isSuggestionsDrawerOpen) => set({ isSuggestionsDrawerOpen }),
    }),
    {
      name: "palimpsest-annotation-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        suggestionsByContext: state.suggestionsByContext,
        isSuggestionsDrawerOpen: state.isSuggestionsDrawerOpen,
      }),
    },
  ),
);
