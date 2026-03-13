"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseResponseJson } from "@/lib/http";

type CloseAccountResponse = {
  success?: boolean;
  setupRequired?: boolean;
  setupHint?: string;
  error?: string;
};

export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [closingAccount, setClosingAccount] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [closeConfirmation, setCloseConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          throw new Error("Unable to load your account.");
        }

        setEmail(user.email ?? "");

        const profileResult = await supabase
          .from("coders")
          .select("display_name")
          .eq("id", user.id)
          .maybeSingle();

        if (profileResult.error) {
          throw new Error(profileResult.error.message);
        }

        const fallbackName = user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "User";
        setDisplayName(profileResult.data?.display_name ?? fallbackName);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load your account.");
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, []);

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSavingProfile(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Unable to resolve your account.");
      }

      const trimmedName = displayName.trim();
      if (!trimmedName) {
        throw new Error("Display name is required.");
      }

      const profileUpdate = await supabase
        .from("coders")
        .update({ display_name: trimmedName })
        .eq("id", user.id);

      if (profileUpdate.error) {
        throw new Error(profileUpdate.error.message);
      }

      const authUpdate = await supabase.auth.updateUser({
        data: {
          ...user.user_metadata,
          display_name: trimmedName,
        },
      });

      if (authUpdate.error) {
        throw new Error(authUpdate.error.message);
      }

      setDisplayName(trimmedName);
      setMessage("Profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setSavingPassword(true);
    setError(null);
    setMessage(null);

    try {
      if (newPassword.length < 8) {
        throw new Error("New password must be at least 8 characters.");
      }

      if (newPassword !== confirmPassword) {
        throw new Error("Password confirmation does not match.");
      }

      const supabase = createClient();
      const updateResult = await supabase.auth.updateUser({ password: newPassword });

      if (updateResult.error) {
        throw new Error(updateResult.error.message);
      }

      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleCloseAccount = async () => {
    if (closeConfirmation !== "CLOSE") {
      setError("Type CLOSE to confirm account closure.");
      return;
    }

    setClosingAccount(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/account/close", {
        method: "POST",
      });

      const payload = await parseResponseJson<CloseAccountResponse>(response, {});
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? payload.setupHint ?? "Failed to close account.");
      }

      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close account.");
    } finally {
      setClosingAccount(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p className="mt-1 text-sm text-gray-600">Manage your profile, password, and account lifecycle.</p>

      {message && <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Recorded Details</h2>
        <form className="mt-3 grid gap-3" onSubmit={handleSaveProfile}>
          <label className="text-xs font-medium text-gray-700" htmlFor="account-email">
            Email
          </label>
          <input
            id="account-email"
            className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm"
            disabled
            value={email}
          />

          <label className="text-xs font-medium text-gray-700" htmlFor="account-display-name">
            Display name
          </label>
          <input
            id="account-display-name"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            disabled={loadingProfile || savingProfile}
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />

          <button
            className="mt-1 w-fit rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            disabled={loadingProfile || savingProfile}
            type="submit"
          >
            {savingProfile ? "Saving..." : "Save Details"}
          </button>
        </form>
      </section>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Password</h2>
        <form className="mt-3 grid gap-3" onSubmit={handleChangePassword}>
          <label className="text-xs font-medium text-gray-700" htmlFor="account-password-new">
            New password
          </label>
          <input
            id="account-password-new"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            minLength={8}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />

          <label className="text-xs font-medium text-gray-700" htmlFor="account-password-confirm">
            Confirm new password
          </label>
          <input
            id="account-password-confirm"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            minLength={8}
            onChange={(event) => setConfirmPassword(event.target.value)}
            type="password"
            value={confirmPassword}
          />

          <button
            className="mt-1 w-fit rounded-md border border-gray-900 bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            disabled={savingPassword}
            type="submit"
          >
            {savingPassword ? "Updating..." : "Change Password"}
          </button>
        </form>
      </section>

      <section className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <h2 className="text-sm font-semibold text-red-900">Close Account</h2>
        <p className="mt-1 text-xs text-red-800">
          Closing your account permanently removes your user record and access to projects.
        </p>

        <label className="mt-3 block text-xs font-medium text-red-900" htmlFor="account-close-confirmation">
          Type CLOSE to confirm
        </label>
        <input
          id="account-close-confirmation"
          className="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm"
          onChange={(event) => setCloseConfirmation(event.target.value)}
          value={closeConfirmation}
        />

        <button
          className="mt-3 rounded-md border border-red-500 bg-red-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          disabled={closingAccount}
          onClick={() => void handleCloseAccount()}
          type="button"
        >
          {closingAccount ? "Closing account..." : "Close Account"}
        </button>
      </section>
    </main>
  );
}
