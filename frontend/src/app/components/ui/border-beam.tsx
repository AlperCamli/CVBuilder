import React from "react";

export interface BorderBeamProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  bgColor?: string;
  textColor?: string;
}

export function BorderBeam({
  children,
  className = "",
  duration = 3,
  delay = 0,
  colorFrom = "var(--color-teal-400)",
  colorTo = "var(--color-teal-600)",
  bgColor = "var(--color-teal-600)",
  textColor = "white",
  ...props
}: BorderBeamProps) {
  return (
    <button
      className={`group relative inline-flex items-center justify-center overflow-hidden rounded-lg font-medium transition-all duration-300 ${className}`}
      style={{
        background: bgColor,
        padding: 0,
        position: "relative",
        boxShadow: "0 4px 12px rgba(15, 110, 86, 0.2)",
      }}
      {...props}
    >
      {/* Animated border glow */}
      <div
        className="absolute inset-0 rounded-lg opacity-75"
        style={{
          background: `linear-gradient(90deg, transparent, ${colorFrom}, ${colorTo}, transparent)`,
          backgroundSize: "200% 100%",
          animation: `border-beam ${duration}s linear infinite`,
          animationDelay: `${delay}s`,
          filter: "blur(8px)",
        }}
      />

      {/* Content */}
      <span
        className="relative z-10 flex items-center justify-center w-full h-full rounded-lg px-6 py-3 transition-all duration-300 group-hover:scale-[1.02]"
        style={{
          background: bgColor,
        }}
      >
        <span
          className="relative z-10 font-semibold"
          style={{
            color: textColor,
          }}
        >
          {children}
        </span>
      </span>
    </button>
  );
}
