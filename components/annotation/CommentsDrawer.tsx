"use client";

import { FormEvent, useMemo, useState } from "react";
import { DocumentComment } from "@/lib/types";

type QuoteDraft = {
  text: string;
  start: number;
  end: number;
};

type Props = {
  comments: DocumentComment[];
  isOpen: boolean;
  showLaunchButton?: boolean;
  pendingQuote: QuoteDraft | null;
  onOpen: () => void;
  onClose: () => void;
  onClearPendingQuote: () => void;
  onCreateComment: (input: { body: string; quote: QuoteDraft | null }) => Promise<void>;
  onReply: (input: { parentId: string; body: string }) => Promise<void>;
};

export default function CommentsDrawer({
  comments,
  isOpen,
  showLaunchButton = true,
  pendingQuote,
  onOpen,
  onClose,
  onClearPendingQuote,
  onCreateComment,
  onReply,
}: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyBusyId, setReplyBusyId] = useState<string | null>(null);

  const { roots, repliesByParent } = useMemo(() => {
    const sorted = [...comments].sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    const rootComments = sorted.filter((comment) => !comment.parent_id);
    const childMap = new Map<string, DocumentComment[]>();

    sorted
      .filter((comment) => Boolean(comment.parent_id))
      .forEach((comment) => {
        const parentId = comment.parent_id as string;
        const current = childMap.get(parentId) ?? [];
        current.push(comment);
        childMap.set(parentId, current);
      });

    return { roots: rootComments, repliesByParent: childMap };
  }, [comments]);

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim()) return;

    setBusy(true);
    setError(null);

    try {
      await onCreateComment({ body: draft.trim(), quote: pendingQuote });
      setDraft("");
      onClearPendingQuote();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add comment.");
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (parentId: string) => {
    const text = (replyDrafts[parentId] ?? "").trim();
    if (!text) return;

    setReplyBusyId(parentId);
    setError(null);

    try {
      await onReply({ parentId, body: text });
      setReplyDrafts((current) => ({ ...current, [parentId]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add reply.");
    } finally {
      setReplyBusyId(null);
    }
  };

  return (
    <>
      {showLaunchButton && !isOpen && (
        <button
          className="absolute right-3 top-14 z-30 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-900"
          onClick={onOpen}
          type="button"
        >
          Show Comments ({comments.length})
        </button>
      )}

      {isOpen && (
        <aside className="absolute bottom-0 right-0 top-0 z-40 w-96 border-l border-gray-200 bg-white/95 p-4 shadow-xl backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Comments ({comments.length})</h3>
            <button
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-800"
              onClick={onClose}
              type="button"
            >
              Hide
            </button>
          </div>

          <form className="mt-3 space-y-2" onSubmit={submitComment}>
            {pendingQuote && (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-2">
                <p className="text-[11px] font-medium text-sky-900">Quoted selection</p>
                <p className="mt-1 text-xs text-sky-800">"{pendingQuote.text}"</p>
                <button
                  className="mt-1 text-[11px] font-medium text-sky-700 underline"
                  onClick={onClearPendingQuote}
                  type="button"
                >
                  Clear quote
                </button>
              </div>
            )}

            <textarea
              className="min-h-20 w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a comment..."
              value={draft}
            />

            <button
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
              disabled={busy || !draft.trim()}
              type="submit"
            >
              {busy ? "Posting..." : "Post Comment"}
            </button>
          </form>

          {error && <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

          <ul className="mt-3 max-h-[62vh] space-y-3 overflow-y-auto pr-1">
            {roots.map((comment) => (
              <li key={comment.id} className="rounded-md border border-gray-200 p-2">
                <p className="text-xs font-semibold">{comment.author_name}</p>
                <p className="text-[11px] text-gray-500">{new Date(comment.created_at).toLocaleString()}</p>
                {comment.quoted_text && (
                  <p className="mt-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">"{comment.quoted_text}"</p>
                )}
                <p className="mt-1 text-sm text-gray-800">{comment.body}</p>

                <div className="mt-2 space-y-2 border-l border-gray-200 pl-2">
                  {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                    <div key={reply.id} className="rounded-md bg-gray-50 p-2">
                      <p className="text-xs font-semibold">{reply.author_name}</p>
                      <p className="text-[11px] text-gray-500">{new Date(reply.created_at).toLocaleString()}</p>
                      <p className="mt-1 text-xs text-gray-800">{reply.body}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex gap-2">
                  <input
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
                    onChange={(event) =>
                      setReplyDrafts((current) => ({
                        ...current,
                        [comment.id]: event.target.value,
                      }))
                    }
                    placeholder="Reply..."
                    value={replyDrafts[comment.id] ?? ""}
                  />
                  <button
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-900 disabled:opacity-50"
                    disabled={replyBusyId === comment.id || !(replyDrafts[comment.id] ?? "").trim()}
                    onClick={() => void submitReply(comment.id)}
                    type="button"
                  >
                    {replyBusyId === comment.id ? "..." : "Reply"}
                  </button>
                </div>
              </li>
            ))}

            {comments.length === 0 && <p className="text-xs text-gray-600">No comments yet.</p>}
          </ul>
        </aside>
      )}
    </>
  );
}
