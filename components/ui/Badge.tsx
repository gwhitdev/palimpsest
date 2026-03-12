import { clsx } from "clsx";

type Props = {
  children: React.ReactNode;
  className?: string;
};

export default function Badge({ children, className }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-800",
        className,
      )}
    >
      {children}
    </span>
  );
}
