import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PublicHeader } from "../components/PublicHeader";
import {
  getCareerArticlePath,
  getCareerArticlesByCategory,
  getCareerCategory,
} from "../../content/career-advice";

export function CareerCategory() {
  const { categorySlug } = useParams();
  const category = getCareerCategory(categorySlug);
  const articles = getCareerArticlesByCategory(categorySlug);

  if (!category) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-3xl mx-auto px-6 py-20">
          <Link
            to="/career-advice"
            className="inline-flex items-center gap-2 mb-8"
            style={{ fontSize: "13px", color: "var(--color-teal-700)" }}
          >
            <ArrowLeft size={15} /> Career advice
          </Link>
          <h1
            className="font-medium mb-3"
            style={{ fontSize: "28px", color: "var(--color-text-primary)" }}
          >
            Category not found
          </h1>
          <p style={{ fontSize: "15px", color: "var(--color-text-secondary)" }}>
            This topic is not available. Browse the career advice hub for current guides.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader activeCategorySlug={category.slug} />

      <main>
        <section className="max-w-7xl mx-auto px-6 pt-12 pb-10">
          <Link
            to="/career-advice"
            className="inline-flex items-center gap-2 mb-8"
            style={{ fontSize: "13px", color: "var(--color-teal-700)" }}
          >
            <ArrowLeft size={15} /> Career advice
          </Link>
          <div className="max-w-3xl">
            <p
              className="uppercase tracking-wider mb-3"
              style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-teal-600)" }}
            >
              Topic
            </p>
            <h1
              className="font-medium mb-4"
              style={{ fontSize: "34px", lineHeight: "1.18", color: "var(--color-text-primary)" }}
            >
              {category.name}
            </h1>
            <p style={{ fontSize: "15px", lineHeight: "1.7", color: "var(--color-text-secondary)" }}>
              {category.description}
            </p>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {articles.map((article) => (
              <article
                key={article.slug}
                className="border rounded-lg p-6 flex flex-col"
                style={{
                  borderColor: "var(--color-border-tertiary)",
                  background: "var(--color-background-primary)",
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <span
                    className="rounded-full px-3 py-1"
                    style={{
                      fontSize: "12px",
                      background: "var(--color-teal-50)",
                      color: "var(--color-teal-800)",
                    }}
                  >
                    {article.priorityRule}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {article.readingTime}
                  </span>
                </div>
                <h2
                  className="font-medium mb-3"
                  style={{ fontSize: "22px", lineHeight: "1.25", color: "var(--color-text-primary)" }}
                >
                  <Link to={getCareerArticlePath(article)}>{article.title}</Link>
                </h2>
                <p
                  className="mb-5 grow"
                  style={{ fontSize: "14px", lineHeight: "1.65", color: "var(--color-text-secondary)" }}
                >
                  {article.description}
                </p>
                <Link
                  to={getCareerArticlePath(article)}
                  className="inline-flex items-center gap-2 font-medium"
                  style={{ fontSize: "13px", color: "var(--color-teal-700)" }}
                >
                  Read the Article <ArrowRight size={15} />
                </Link>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
