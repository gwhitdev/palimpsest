import { kappaInterpretation } from "@/lib/kappa";

type Props = {
  kappa: number;
};

export default function KappaDisplay({ kappa }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold">Inter-rater agreement</p>
      <p className="mt-2 text-2xl font-bold">{Number.isFinite(kappa) ? kappa.toFixed(3) : "0.000"}</p>
      <p className="mt-1 text-sm text-gray-600">{kappaInterpretation(kappa)}</p>
    </div>
  );
}
