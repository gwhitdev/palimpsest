type FrequencyDatum = {
  techId: string;
  count: number;
};

type Props = {
  data: FrequencyDatum[];
};

export default function FrequencyChart({ data }: Props) {
  const max = Math.max(1, ...data.map((item) => item.count));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold">Technique Frequency</p>
      <ul className="space-y-2">
        {data.map((item) => (
          <li key={item.techId}>
            <div className="mb-1 flex items-center justify-between text-xs text-gray-700">
              <span>{item.techId}</span>
              <span>{item.count}</span>
            </div>
            <div className="h-2 rounded bg-gray-100">
              <div
                className="h-2 rounded bg-gray-900"
                style={{ width: `${Math.round((item.count / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
