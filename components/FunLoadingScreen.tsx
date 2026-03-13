type FunLoadingScreenProps = {
  message?: string;
  fullScreen?: boolean;
};

export default function FunLoadingScreen({
  message = "Summoning your annotation universe...",
  fullScreen = true,
}: FunLoadingScreenProps) {
  return (
    <div
      className={`${fullScreen ? "fixed inset-0 z-[100]" : "min-h-screen"} palimpsest-loader-bg flex items-center justify-center overflow-hidden px-6`}
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-black/10 bg-white/85 p-8 text-center shadow-2xl backdrop-blur-sm">
        <div className="palimpsest-loader-orb -top-6 left-6" />
        <div className="palimpsest-loader-orb -bottom-6 right-6" />

        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-gray-500">Palimpsest</p>
        <h2 className="mt-3 text-2xl font-bold text-gray-900">Preparing Your Workspace</h2>
        <p className="mt-2 text-sm text-gray-700">{message}</p>

        <div className="mt-6 flex items-center justify-center gap-2">
          <span className="palimpsest-loader-dot" />
          <span className="palimpsest-loader-dot palimpsest-loader-dot-delay-1" />
          <span className="palimpsest-loader-dot palimpsest-loader-dot-delay-2" />
        </div>

        <div className="mt-6 rounded-lg bg-gray-100 p-3">
          <div className="palimpsest-loader-bar" />
        </div>
      </div>
    </div>
  );
}
