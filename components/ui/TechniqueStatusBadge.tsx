"use client";

type Status = "DRAFT" | "UNDER REVISION" | "LOCKED";

type Props = {
  status: Status;
  kappa?: number;
};

const statusStyles: Record<Status, string> = {
  DRAFT: "bg-gray-100 text-gray-600 border-gray-200",
  "UNDER REVISION": "bg-amber-50 text-amber-700 border-amber-200",
  LOCKED: "bg-green-50 text-green-700 border-green-200",
};

const statusIcons: Record<Status, string> = {
  DRAFT: "D",
  "UNDER REVISION": "R",
  LOCKED: "L",
};

export default function TechniqueStatusBadge({ status, kappa }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyles[status]}`}
    >
      <span>{statusIcons[status]}</span>
      {status}
      {kappa !== undefined && Number.isFinite(kappa) && (
        <span className="ml-1 opacity-70">k {kappa.toFixed(2)}</span>
      )}
    </span>
  );
}
