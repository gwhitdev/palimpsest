export type TechniqueLevel = 1 | 2 | 3;

export interface Technique {
  id: string;
  name: string;
  plainName: string;
  definition: string;
  theory: string;
  detection: string[];
  userLabel: string;
  level: TechniqueLevel;
}

export interface Document {
  id: string;
  project_id?: string;
  title: string;
  source: string | null;
  content: string;
  created_at: string;
}

export interface DocumentWithAssignments extends Document {
  assignedCoderIds: string[];
}

export interface Coder {
  id: string;
  display_name: string;
  role: "owner" | "coder";
  created_at?: string;
  grantPermissions?: string[];
  denyPermissions?: string[];
}

export interface Annotation {
  id: string;
  project_id?: string;
  document_id: string;
  coder_id: string;
  coder_name: string;
  tech_id: string;
  quoted_text: string;
  start_offset: number;
  end_offset: number;
  is_ai: boolean;
  accepted: boolean;
  created_at: string;
}

export interface AnnotatorUser {
  id: string;
  display_name: string;
  role?: "owner" | "coder";
}

export interface DocumentComment {
  id: string;
  project_id?: string;
  document_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  quoted_text: string | null;
  start_offset: number | null;
  end_offset: number | null;
  created_at: string;
}

export interface AISuggestion {
  techId: string;
  text: string;
  confidence?: number;
}
