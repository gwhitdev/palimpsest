"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);

    const supabase = createClient();
    if (mode === "signup") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName.trim(),
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        router.push("/dashboard");
        router.refresh();
        return;
      }

      setMessage("Account created. Check your email to confirm your account, then sign in.");
      setMode("signin");
      setPassword("");
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    const redirectTarget = new URLSearchParams(window.location.search).get("next");
    const nextPath = redirectTarget && redirectTarget.startsWith("/") ? redirectTarget : "/dashboard";

    router.push(nextPath);
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <form className="w-full space-y-4 rounded-xl border border-gray-200 bg-white p-6" onSubmit={handleSubmit}>
        <div>
          <h1 className="text-xl font-semibold">{mode === "signin" ? "Sign in" : "Create account"}</h1>
          <p className="text-sm text-gray-600">
            {mode === "signin"
              ? "Use your Palimpsest account to continue."
              : "Register a new account to access the annotation workflow."}
          </p>
        </div>

        {mode === "signup" && (
          <label className="block text-sm font-medium">
            Display name
            <input
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
              onChange={(e) => setDisplayName(e.target.value)}
              required
              type="text"
              value={displayName}
            />
          </label>
        )}

        <label className="block text-sm font-medium">
          Email
          <input
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label className="block text-sm font-medium">
          Password
          <input
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            onChange={(e) => setPassword(e.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        {message && <p className="text-sm text-green-700">{message}</p>}

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={loading}
          type="submit"
        >
          {loading ? (mode === "signin" ? "Signing in..." : "Creating account...") : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <button
          className="w-full text-sm font-medium text-gray-700 underline"
          onClick={() => {
            setMode((current) => (current === "signin" ? "signup" : "signin"));
            setMessage(null);
            setError(null);
          }}
          type="button"
        >
          {mode === "signin"
            ? "Need an account? Register"
            : "Already have an account? Sign in"}
        </button>

        {mode === "signin" && (
          <p className="text-center text-sm text-gray-700">
            Prefer a dedicated sign-up page?{" "}
            <Link className="font-medium underline" href="/register">
              Open register
            </Link>
          </p>
        )}
      </form>
    </main>
  );
}
