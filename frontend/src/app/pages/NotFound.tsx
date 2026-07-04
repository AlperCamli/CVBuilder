import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { PublicHeader } from "../components/PublicHeader";

export function NotFound() {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      <main className="max-w-3xl mx-auto px-6 py-24 text-center">
        <p
          className="uppercase tracking-wider mb-3"
          style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-teal-600)" }}
        >
          404
        </p>
        <h1
          className="font-medium mb-4"
          style={{ fontSize: "34px", lineHeight: "1.18", color: "var(--color-text-primary)" }}
        >
          Page not found
        </h1>
        <p
          className="mb-10"
          style={{ fontSize: "15px", lineHeight: "1.7", color: "var(--color-text-secondary)" }}
        >
          The page you are looking for does not exist or has moved. Check the address, or start
          again from the homepage.
        </p>
        <div className="flex items-center justify-center gap-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 font-medium"
            style={{ fontSize: "14px", color: "var(--color-teal-700)" }}
          >
            Go to the homepage <ArrowRight size={15} />
          </Link>
          <Link
            to="/career-advice"
            className="inline-flex items-center gap-2 font-medium"
            style={{ fontSize: "14px", color: "var(--color-teal-700)" }}
          >
            Browse career advice <ArrowRight size={15} />
          </Link>
        </div>
      </main>
    </div>
  );
}
