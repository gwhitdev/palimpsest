import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-4xl font-bold">Palimpsest</h1>
        <p className="mt-2 text-sm text-gray-600">Collaborative rhetorical annotation workflow.</p>
      </div>
      <div className="flex gap-3">
        <Link className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white" href="/login">
          Login
        </Link>
        <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium" href="/register">
          Register
        </Link>
        <Link className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium" href="/project-management">
          Project Management
        </Link>
      </div>
    </main>
  );
}
