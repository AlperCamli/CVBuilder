import React from "react";

export interface RainbowButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function RainbowButton({
  children,
  className = "",
  ...props
}: RainbowButtonProps) {
  return (
    <button
      className={`group relative inline-flex items-center justify-center overflow-hidden rounded-lg font-medium transition-all duration-300 ${className}`}
      style={{
        background:
          "linear-gradient(90deg, #a855f7, #ec4899, #ef4444, #f59e0b, #eab308, #84cc16, #22c55e, #14b8a6, #06b6d4, #3b82f6, #6366f1, #8b5cf6)",
        backgroundSize: "200% 100%",
        animation: "rainbow 3s linear infinite",
        padding: "1px",
      }}
      {...props}
    >
      <span
        className="relative flex items-center justify-center w-full h-full rounded-lg px-6 py-3 transition-all duration-300"
        style={{
          background: "var(--color-background-primary)",
        }}
      >
        <span
          className="relative z-10 font-semibold"
          style={{
            background:
              "linear-gradient(90deg, #a855f7, #ec4899, #ef4444, #f59e0b, #eab308, #84cc16, #22c55e, #14b8a6, #06b6d4, #3b82f6, #6366f1, #8b5cf6)",
            backgroundSize: "200% 100%",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            animation: "rainbow 3s linear infinite",
          }}
        >
          {children}
        </span>
      </span>
    </button>
  );
}
