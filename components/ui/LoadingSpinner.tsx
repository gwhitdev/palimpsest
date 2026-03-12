export default function LoadingSpinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900"
      aria-label="Loading"
      role="status"
    />
  );
}
