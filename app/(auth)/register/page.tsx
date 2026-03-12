"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const router = useRouter();
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
      router.push("/project-management");
      router.refresh();
      return;
    }

    setMessage("Account created. Check your email to confirm your account, then sign in.");
    setPassword("");
    setLoading(false);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <form className="w-full space-y-4 rounded-xl border border-gray-200 bg-white p-6" onSubmit={handleSubmit}>
        <div>
          <h1 className="text-xl font-semibold">Create account</h1>
          <p className="text-sm text-gray-600">Register a new Palimpsest user.</p>
        </div>

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
            minLength={6}
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
          {loading ? "Creating account..." : "Create account"}
        </button>

        <p className="text-center text-sm text-gray-700">
          Already have an account?{" "}
          <Link className="font-medium underline" href="/login">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
