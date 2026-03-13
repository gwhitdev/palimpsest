"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode } from "react";
import ProjectsMenu from "@/components/navigation/ProjectsMenu";
import { createClient } from "@/lib/supabase/client";

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <p className="text-sm font-semibold">Palimpsest</p>
          <div className="flex items-center gap-4 text-sm">
            <ProjectsMenu />
            <Link className="text-gray-700 hover:text-black" href="/research-checklist">
              Research Checklist
            </Link>
            <Link className="text-gray-700 hover:text-black" href="/account">
              Account
            </Link>
            <button
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800"
              onClick={() => void handleSignOut()}
              type="button"
            >
              Sign out
            </button>
          </div>
        </nav>
      </header>
      <div>{children}</div>
    </div>
  );
}
