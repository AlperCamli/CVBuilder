import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PublicHeader } from "../components/PublicHeader";
import {
  getCareerArticle,
  getCareerArticlePath,
  getCareerArticlesByCategory,
  getCareerCategory,
  getCareerCategoryPath,
} from "../../content/career-advice";

export function CareerArticle() {
  const { categorySlug, articleSlug } = useParams();
  const category = getCareerCategory(categorySlug);
  const article = getCareerArticle(categorySlug, articleSlug);
  const relatedArticles = getCareerArticlesByCategory(categorySlug).filter(
    (item) => item.slug !== articleSlug
  );

  if (!article) {
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
            Article not found
          </h1>
          <p style={{ fontSize: "15px", color: "var(--color-text-secondary)" }}>
            This guide is not available. Browse the career advice hub for current drafts.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader activeCategorySlug={category?.slug} />

      <main>
        <article className="max-w-3xl mx-auto px-6 pt-12 pb-16">
          <Link
            to={category ? getCareerCategoryPath(category) : "/career-advice"}
            className="inline-flex items-center gap-2 mb-8"
            style={{ fontSize: "13px", color: "var(--color-teal-700)" }}
          >
            <ArrowLeft size={15} /> {category?.name ?? "Career advice"}
          </Link>

          <div className="flex items-center gap-2 mb-5">
            <span
              className="rounded-full px-3 py-1"
              style={{
                fontSize: "12px",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
              }}
            >
              {article.category}
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              {article.readingTime}
            </span>
          </div>

          <h1
            className="font-medium mb-5"
            style={{ fontSize: "36px", lineHeight: "1.15", color: "var(--color-text-primary)" }}
          >
            {article.title}
          </h1>
          <p
            className="mb-5"
            style={{ fontSize: "17px", lineHeight: "1.65", color: "var(--color-text-secondary)" }}
          >
            {article.description}
          </p>
          <p
            className="mb-10"
            style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}
          >
            Updated {new Date(`${article.updatedDate}T00:00:00`).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>

          <div
            className="aspect-[16/9] rounded-lg border mb-10 overflow-hidden flex items-center justify-center"
            style={{
              borderColor: "var(--color-border-tertiary)",
              background:
                "linear-gradient(135deg, var(--color-teal-50) 0%, var(--color-slate-50) 100%)",
            }}
          >
            <img src="/images/og-image.png" alt="" className="w-full h-full object-cover" />
          </div>

          <div>
            {article.body.length === 0 ? (
              <div
                className="border rounded-lg p-6"
                style={{
                  borderColor: "var(--color-border-tertiary)",
                  background: "var(--color-slate-50)",
                }}
              >
                <h2
                  className="font-medium mb-2"
                  style={{ fontSize: "18px", color: "var(--color-text-primary)" }}
                >
                  Content draft pending
                </h2>
                <p style={{ fontSize: "14px", lineHeight: "1.65", color: "var(--color-text-secondary)" }}>
                  This article page is ready for publishing infrastructure. The final
                  article body will be added here when the content is provided.
                </p>
              </div>
            ) : article.body.map((block, index) => {
              if (block.type === "heading") {
                return (
                  <h2
                    key={`${block.type}-${index}`}
                    className="font-medium mt-9 mb-3"
                    style={{ fontSize: "22px", lineHeight: "1.3", color: "var(--color-text-primary)" }}
                  >
                    {block.text}
                  </h2>
                );
              }

              if (block.type === "list") {
                return (
                  <ul key={`${block.type}-${index}`} className="space-y-2 my-5 pl-5 list-disc">
                    {block.items.map((item) => (
                      <li
                        key={item}
                        style={{ fontSize: "15px", lineHeight: "1.65", color: "var(--color-text-secondary)" }}
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                );
              }

              return (
                <p
                  key={`${block.type}-${index}`}
                  className="mb-5"
                  style={{ fontSize: "15px", lineHeight: "1.75", color: "var(--color-text-secondary)" }}
                >
                  {block.text}
                </p>
              );
            })}
          </div>
        </article>

        {relatedArticles.length > 0 ? (
          <section className="max-w-3xl mx-auto px-6 pb-20">
            <div
              className="border rounded-lg p-6"
              style={{
                borderColor: "var(--color-border-tertiary)",
                background: "var(--color-background-primary)",
              }}
            >
              <h2
                className="font-medium mb-4"
                style={{ fontSize: "18px", color: "var(--color-text-primary)" }}
              >
                Keep reading
              </h2>
              {relatedArticles.map((item) => (
                <Link
                  key={item.slug}
                  to={getCareerArticlePath(item)}
                  className="flex items-center justify-between gap-4 py-3 border-t"
                  style={{ borderColor: "var(--color-border-tertiary)" }}
                >
                  <span style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                    {item.title}
                  </span>
                  <ArrowRight size={15} style={{ color: "var(--color-teal-700)", flexShrink: 0 }} />
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
