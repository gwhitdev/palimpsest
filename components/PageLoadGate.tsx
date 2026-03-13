"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import FunLoadingScreen from "@/components/FunLoadingScreen";

type PageLoadGateProps = {
  children: ReactNode;
};

declare global {
  interface Window {
    __palimpsestFetchPatched?: boolean;
    __palimpsestOriginalFetch?: typeof window.fetch;
    __palimpsestPendingFetchCount?: number;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function setupFetchTracker() {
  if (typeof window === "undefined") return;
  if (window.__palimpsestFetchPatched) return;

  window.__palimpsestOriginalFetch = window.fetch.bind(window);
  window.__palimpsestPendingFetchCount = 0;

  window.fetch = async (...args) => {
    window.__palimpsestPendingFetchCount = (window.__palimpsestPendingFetchCount ?? 0) + 1;
    try {
      return await (window.__palimpsestOriginalFetch as typeof window.fetch)(...args);
    } finally {
      window.__palimpsestPendingFetchCount = Math.max(
        0,
        (window.__palimpsestPendingFetchCount ?? 1) - 1,
      );
    }
  };

  window.__palimpsestFetchPatched = true;
}

function pendingFetchCount() {
  return window.__palimpsestPendingFetchCount ?? 0;
}

async function waitForWindowLoad(cancelledRef: React.MutableRefObject<boolean>) {
  if (document.readyState === "complete") return;

  await new Promise<void>((resolve) => {
    const onLoad = () => resolve();
    window.addEventListener("load", onLoad, { once: true });
  });

  if (cancelledRef.current) return;
}

async function waitForNetworkIdle(cancelledRef: React.MutableRefObject<boolean>) {
  let idleSince = 0;

  while (!cancelledRef.current) {
    const pending = pendingFetchCount();
    const now = performance.now();

    if (pending === 0) {
      if (idleSince === 0) {
        idleSince = now;
      } else if (now - idleSince >= 250) {
        return;
      }
    } else {
      idleSince = 0;
    }

    await sleep(50);
  }
}

function countPendingAssets() {
  let pending = 0;

  const stylesheets = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  ) as HTMLLinkElement[];
  stylesheets.forEach((link) => {
    if (!link.sheet) pending += 1;
  });

  const images = Array.from(document.images);
  images.forEach((image) => {
    if (image.loading === "lazy") {
      image.loading = "eager";
    }

    if (!image.complete) {
      pending += 1;
    }
  });

  return pending;
}

async function waitForAssets(cancelledRef: React.MutableRefObject<boolean>) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  while (!cancelledRef.current) {
    if (countPendingAssets() === 0) return;
    await sleep(50);
  }
}

export default function PageLoadGate({ children }: PageLoadGateProps) {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    setupFetchTracker();
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    setIsLoading(true);

    const run = async () => {
      if (!mountedRef.current) {
        mountedRef.current = true;
        await waitForWindowLoad(cancelledRef);
      }

      if (cancelledRef.current) return;

      await sleep(0);
      await waitForNetworkIdle(cancelledRef);
      if (cancelledRef.current) return;

      await waitForAssets(cancelledRef);
      if (cancelledRef.current) return;

      setIsLoading(false);
    };

    void run();

    return () => {
      cancelledRef.current = true;
    };
  }, [pathname]);

  return (
    <>
      {children}
      {isLoading && <FunLoadingScreen message="Aligning highlights, notes, and AI hints..." />}
    </>
  );
}
