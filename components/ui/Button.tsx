import { clsx } from "clsx";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export default function Button({ className, variant = "primary", ...props }: Props) {
  return (
    <button
      className={clsx(
        "rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" ? "bg-gray-900 text-white hover:bg-black" : "bg-gray-100 text-gray-900 hover:bg-gray-200",
        className,
      )}
      {...props}
    />
  );
}
