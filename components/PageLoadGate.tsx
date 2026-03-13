"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import FunLoadingScreen from "@/components/FunLoadingScreen";

type PageLoadGateProps = {
  children: ReactNode;
};

const MIN_LOADER_MS = 700;

export default function PageLoadGate({ children }: PageLoadGateProps) {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(false);

  useEffect(() => {
    let timeoutId: number | undefined;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      setIsLoading(false);
    };

    setIsLoading(true);

    if (!mountedRef.current) {
      mountedRef.current = true;

      const onLoad = () => {
        timeoutId = window.setTimeout(finish, MIN_LOADER_MS);
      };

      if (document.readyState === "complete") {
        onLoad();
      } else {
        window.addEventListener("load", onLoad, { once: true });
        timeoutId = window.setTimeout(onLoad, MIN_LOADER_MS);
      }

      return () => {
        if (timeoutId) window.clearTimeout(timeoutId);
        window.removeEventListener("load", onLoad);
      };
    }

    timeoutId = window.setTimeout(finish, MIN_LOADER_MS);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [pathname]);

  return (
    <>
      {children}
      {isLoading && <FunLoadingScreen message="Aligning highlights, notes, and AI hints..." />}
    </>
  );
}
