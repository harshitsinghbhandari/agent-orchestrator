"use client";

import dynamic from "next/dynamic";

const OrchestrationCanvas = dynamic(
  () => import("@/components/OrchestrationCanvas"),
  { ssr: false }
);

export default function HeroCanvas() {
  return (
    <div className="hidden lg:flex items-center justify-center">
      <div className="w-full aspect-square max-w-[500px]">
        <OrchestrationCanvas />
      </div>
    </div>
  );
}
