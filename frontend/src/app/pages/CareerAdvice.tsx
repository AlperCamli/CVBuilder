import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { PublicHeader } from "../components/PublicHeader";
import { Breadcrumbs } from "../components/Breadcrumbs";
import {
  CAREER_CATEGORIES,
  getCareerArticlePath,
  getCareerArticlesByCategory,
  getCareerCategoryPath,
} from "../../content/career-advice";

export function CareerAdvice() {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      <main>
        <section className="max-w-7xl mx-auto px-6 pt-16 pb-10">
          <Breadcrumbs
            className="mb-8"
            items={[{ name: "Home", path: "/" }, { name: "Career advice" }]}
          />
          <div className="max-w-3xl">
            <p
              className="uppercase tracking-wider mb-3"
              style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-teal-600)" }}
            >
              Career advice
            </p>
            <h1
              className="font-medium mb-4"
              style={{ fontSize: "34px", lineHeight: "1.18", color: "var(--color-text-primary)" }}
            >
              CV Advice for Getting More Interviews
            </h1>
            <p
              style={{ fontSize: "15px", lineHeight: "1.7", color: "var(--color-text-secondary)" }}
            >
              Learn how to write a clearer CV, tailor it to a job description,
              improve ATS readability, and build stronger medical and NHS applications.
            </p>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 py-12">
          <div className="space-y-14">
            {CAREER_CATEGORIES.map((category) => {
              const articles = getCareerArticlesByCategory(category.slug);
              return (
                <section key={category.slug} aria-labelledby={`topic-${category.slug}`}>
                  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
                    <div className="max-w-2xl">
                      <h2
                        id={`topic-${category.slug}`}
                        className="font-medium mb-2"
                        style={{ fontSize: "23px", color: "var(--color-text-primary)" }}
                      >
                        {category.name}
                      </h2>
                      <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                        {category.description}
                      </p>
                    </div>
                    <Link
                      to={getCareerCategoryPath(category)}
                      className="inline-flex items-center gap-2 font-medium"
                      style={{ fontSize: "13px", color: "var(--color-teal-700)" }}
                    >
                      View topic <ArrowRight size={15} />
                    </Link>
                  </div>

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
                        <h3
                          className="font-medium mb-3"
                          style={{ fontSize: "20px", lineHeight: "1.3", color: "var(--color-text-primary)" }}
                        >
                          <Link to={getCareerArticlePath(article)}>{article.title}</Link>
                        </h3>
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
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
