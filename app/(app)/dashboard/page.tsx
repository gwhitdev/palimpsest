"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Coder, Document, DocumentWithAssignments } from "@/lib/types";

type DocumentApiResponse = {
  documents?: DocumentWithAssignments[];
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

type CoderApiResponse = {
  coders?: Coder[];
  error?: string;
};

type AssignmentDrafts = Record<string, string[]>;

export default function DashboardPage() {
  const [role, setRole] = useState<"admin" | "coder" | null>(null);
  const [documents, setDocuments] = useState<DocumentWithAssignments[]>([]);
  const [coders, setCoders] = useState<Coder[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDrafts>({});
  const [loading, setLoading] = useState(true);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [content, setContent] = useState("");
  const [selectedCoderIds, setSelectedCoderIds] = useState<string[]>([]);

  const coderNameMap = useMemo(() => {
    return new Map(coders.map((coder) => [coder.id, coder.display_name]));
  }, [coders]);

  const buildDrafts = (docs: DocumentWithAssignments[]): AssignmentDrafts => {
    return docs.reduce<AssignmentDrafts>((acc, document) => {
      acc[document.id] = [...document.assignedCoderIds];
      return acc;
    }, {});
  };

  const toggleCoderSelection = (
    list: string[],
    coderId: string,
    checked: boolean,
  ): string[] => {
    if (checked) return [...new Set([...list, coderId])];
    return list.filter((id) => id !== coderId);
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Session expired. Please sign in again.");
      }

      const { data: coderRow, error: coderRoleError } = await supabase
        .from("coders")
        .select("role")
        .eq("id", user.id)
        .single();

      if (coderRoleError) {
        throw new Error(coderRoleError.message);
      }

      const userRole = coderRow?.role === "admin" ? "admin" : "coder";
      setRole(userRole);

      if (userRole === "coder") {
        const { data: docs, error: docsError } = await supabase
          .from("documents")
          .select("id, title, source, content, created_at")
          .order("created_at", { ascending: false });

        if (docsError) {
          throw new Error(docsError.message);
        }

        const coderDocuments: DocumentWithAssignments[] = ((docs ?? []) as Document[]).map((doc) => ({
          ...doc,
          assignedCoderIds: [],
        }));

        setDocuments(coderDocuments);
        setCoders([]);
        setAssignmentDrafts(buildDrafts(coderDocuments));
        setNotice("Signed in as coder. Admin management tools are hidden.");
        return;
      }

      const [documentsResponse, codersResponse] = await Promise.all([
        fetch("/api/admin/documents", { cache: "no-store" }),
        fetch("/api/admin/coders", { cache: "no-store" }),
      ]);

      const docsJson = (await documentsResponse.json()) as DocumentApiResponse;
      const codersJson = (await codersResponse.json()) as CoderApiResponse;

      if (!documentsResponse.ok) {
        throw new Error(docsJson.error ?? "Failed to load documents.");
      }

      if (!codersResponse.ok) {
        throw new Error(codersJson.error ?? "Failed to load coders.");
      }

      const nextDocs = docsJson.documents ?? [];
      const nextCoders = codersJson.coders ?? [];

      setDocuments(nextDocs);
      setCoders(nextCoders);
      setAssignmentDrafts(buildDrafts(nextDocs));

      if (docsJson.setupRequired) {
        setNotice(docsJson.setupHint ?? "Assignment table setup is required.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleCreateDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyDocId("new");
    setError(null);

    try {
      const response = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          source,
          content,
          assignedCoderIds: selectedCoderIds,
        }),
      });

      const payload = (await response.json()) as {
        setupRequired?: boolean;
        setupHint?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create document.");
      }

      if (payload.setupRequired) {
        setNotice(payload.setupHint ?? "Assignment table setup is required.");
      }

      setTitle("");
      setSource("");
      setContent("");
      setSelectedCoderIds([]);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create document.");
    } finally {
      setBusyDocId(null);
    }
  };

  const handleSaveAssignments = async (documentId: string) => {
    setBusyDocId(documentId);
    setError(null);

    try {
      const response = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          coderIds: assignmentDrafts[documentId] ?? [],
        }),
      });

      const payload = (await response.json()) as {
        setupRequired?: boolean;
        setupHint?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save assignments.");
      }

      if (payload.setupRequired) {
        setNotice(payload.setupHint ?? "Assignment table setup is required.");
      }

      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId
            ? {
                ...document,
                assignedCoderIds: [...(assignmentDrafts[documentId] ?? [])],
              }
            : document,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save assignments.");
    } finally {
      setBusyDocId(null);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">{role === "admin" ? "Admin Dashboard" : "Dashboard"}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {role === "admin"
          ? "Upload texts, assign coders, and launch annotation sessions."
          : "Open documents and start annotation sessions."}
      </p>

      {notice && (
        <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {role === "admin" && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Upload Document</h2>
          <form className="mt-3 space-y-3" onSubmit={handleCreateDocument}>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              required
              value={title}
            />

            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setSource(event.target.value)}
              placeholder="Source (optional)"
              value={source}
            />

            <textarea
              className="min-h-40 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste full document text"
              required
              value={content}
            />

            <div>
              <p className="text-xs font-medium text-gray-700">Assign coders on upload</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {coders
                  .filter((coder) => coder.role === "coder")
                  .map((coder) => (
                    <label key={coder.id} className="flex items-center gap-2 text-sm">
                      <input
                        checked={selectedCoderIds.includes(coder.id)}
                        onChange={(event) =>
                          setSelectedCoderIds((current) =>
                            toggleCoderSelection(current, coder.id, event.target.checked),
                          )
                        }
                        type="checkbox"
                      />
                      {coder.display_name}
                    </label>
                  ))}
              </div>
            </div>

            <button
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={busyDocId === "new"}
              type="submit"
            >
              {busyDocId === "new" ? "Saving..." : "Create Document"}
            </button>
          </form>
        </section>
      )}

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Documents</h2>
        {loading && <p className="mt-2 text-sm text-gray-600">Loading...</p>}
        {!loading && documents.length === 0 && (
          <p className="mt-2 text-sm text-gray-600">No documents found yet.</p>
        )}
        <ul className="mt-3 space-y-2">
          {documents.map((document) => (
            <li key={document.id} className="rounded-md border border-gray-100 p-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{document.title}</p>
                  <p className="text-xs text-gray-600">{document.source || "No source"}</p>
                  {role === "admin" && (
                    <p className="mt-1 text-xs text-gray-500">
                      Assigned: {document.assignedCoderIds.length > 0
                        ? document.assignedCoderIds
                            .map((coderId) => coderNameMap.get(coderId) ?? coderId)
                            .join(", ")
                        : "None"}
                    </p>
                  )}
                </div>
                <Link
                  className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white"
                  href={`/annotate/${document.id}`}
                >
                  Open Annotator
                </Link>
              </div>

              {role === "admin" && (
                <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-700">Edit coder assignments</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {coders
                      .filter((coder) => coder.role === "coder")
                      .map((coder) => (
                        <label key={`${document.id}-${coder.id}`} className="flex items-center gap-2 text-sm">
                          <input
                            checked={(assignmentDrafts[document.id] ?? []).includes(coder.id)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setAssignmentDrafts((current) => ({
                                ...current,
                                [document.id]: toggleCoderSelection(
                                  current[document.id] ?? [],
                                  coder.id,
                                  checked,
                                ),
                              }));
                            }}
                            type="checkbox"
                          />
                          {coder.display_name}
                        </label>
                      ))}
                  </div>

                  <button
                    className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900 disabled:opacity-50"
                    disabled={busyDocId === document.id}
                    onClick={() => void handleSaveAssignments(document.id)}
                    type="button"
                  >
                    {busyDocId === document.id ? "Saving..." : "Save Assignments"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
