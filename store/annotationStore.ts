import { create } from "zustand";
import { AISuggestion, Annotation } from "@/lib/types";

interface AnnotationStore {
  annotations: Annotation[];
  aiSuggestions: AISuggestion[];
  activeDocId: string | null;
  isLoadingAI: boolean;
  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  setAISuggestions: (suggestions: AISuggestion[]) => void;
  acceptSuggestion: (index: number) => void;
  dismissSuggestion: (index: number) => void;
  setActiveDocId: (id: string) => void;
  setLoadingAI: (loading: boolean) => void;
}

export const useAnnotationStore = create<AnnotationStore>((set) => ({
  annotations: [],
  aiSuggestions: [],
  activeDocId: null,
  isLoadingAI: false,
  setAnnotations: (annotations) => set({ annotations }),
  addAnnotation: (annotation) =>
    set((state) => ({ annotations: [...state.annotations, annotation] })),
  removeAnnotation: (id) =>
    set((state) => ({
      annotations: state.annotations.filter((annotation) => annotation.id !== id),
    })),
  setAISuggestions: (aiSuggestions) => set({ aiSuggestions }),
  acceptSuggestion: (index) =>
    set((state) => ({
      aiSuggestions: state.aiSuggestions.filter((_, idx) => idx !== index),
    })),
  dismissSuggestion: (index) =>
    set((state) => ({
      aiSuggestions: state.aiSuggestions.filter((_, idx) => idx !== index),
    })),
  setActiveDocId: (activeDocId) => set({ activeDocId }),
  setLoadingAI: (isLoadingAI) => set({ isLoadingAI }),
}));
