import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { PublicHeader } from "../components/PublicHeader";
import { Breadcrumbs, type BreadcrumbItem } from "../components/Breadcrumbs";
import {
  type ArticleTextLink,
  getCareerArticle,
  getCareerArticlePath,
  getCareerArticlesByCategory,
  getCareerCategory,
  getCareerCategoryPath,
} from "../../content/career-advice";
import { trackBlogCtaClick } from "../integration/analytics";

function renderLinkedText(text: string, links: ArticleTextLink[] = []): ReactNode {
  if (links.length === 0) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  links.forEach((link) => {
    const start = text.indexOf(link.text, cursor);

    if (start === -1) {
      return;
    }

    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }

    const linkStyle = {
      color: "var(--color-teal-700)",
      textDecoration: "underline",
      textUnderlineOffset: "3px",
    };

    if (link.href.startsWith("/")) {
      parts.push(
        <Link key={`${link.href}-${start}`} to={link.href} style={linkStyle}>
          {link.text}
        </Link>
      );
    } else {
      parts.push(
        <a key={`${link.href}-${start}`} href={link.href} style={linkStyle}>
          {link.text}
        </a>
      );
    }

    cursor = start + link.text.length;
  });

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
}

export function CareerArticle() {
  const { categorySlug, articleSlug } = useParams();
  const { hash } = useLocation();
  const category = getCareerCategory(categorySlug);
  const article = getCareerArticle(categorySlug, articleSlug);
  const relatedArticles = getCareerArticlesByCategory(categorySlug).filter(
    (item) => item.slug !== articleSlug
  );

  // Cross-page links can target a section (e.g. .../ats-friendly-resume-format#ats-optimization).
  // The browser only handles fragments on full page loads, so scroll on SPA navigation too.
  useEffect(() => {
    if (!hash) {
      return;
    }
    const target = document.getElementById(hash.slice(1));
    if (target) {
      target.scrollIntoView();
    }
  }, [hash, articleSlug]);

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

  const heroImagePath =
    article.heroImage.replace(/^https?:\/\/[^/]+/, "") || "/images/og-image.png";
  const heroWebpPath = heroImagePath.replace(/\.(png|jpe?g)$/i, ".webp");

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader activeCategorySlug={category?.slug} />

      <main>
        <article className="max-w-3xl mx-auto px-6 pt-12 pb-16">
          <Breadcrumbs
            className="mb-8"
            items={[
              { name: "Home", path: "/" },
              { name: "Career advice", path: "/career-advice" },
              ...(category
                ? [{ name: category.name, path: getCareerCategoryPath(category) } satisfies BreadcrumbItem]
                : []),
              { name: article.title },
            ]}
          />

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
            className="aspect-[16/9] rounded-lg border mb-6 overflow-hidden flex items-center justify-center"
            style={{
              borderColor: "var(--color-border-tertiary)",
              background:
                "linear-gradient(135deg, var(--color-teal-50) 0%, var(--color-slate-50) 100%)",
            }}
          >
            <picture className="w-full h-full">
              <source srcSet={heroWebpPath} type="image/webp" />
              <img
                src={heroImagePath}
                alt={`Cover illustration: ${article.title}`}
                width="1200"
                height="675"
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </picture>
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
                    id={block.id}
                    className="font-medium mt-9 mb-3"
                    style={{
                      fontSize: "22px",
                      lineHeight: "1.3",
                      color: "var(--color-text-primary)",
                      scrollMarginTop: "88px",
                    }}
                  >
                    {renderLinkedText(block.text, block.links)}
                  </h2>
                );
              }

              if (block.type === "toc") {
                return (
                  <nav
                    key={`${block.type}-${index}`}
                    aria-label="Table of contents"
                    className="rounded-lg border p-5 mb-8"
                    style={{
                      borderColor: "var(--color-border-tertiary)",
                      background: "var(--color-slate-50)",
                    }}
                  >
                    <p
                      className="font-medium mb-3"
                      style={{ fontSize: "14px", color: "var(--color-text-primary)" }}
                    >
                      {block.heading}
                    </p>
                    <ul className="space-y-1.5 columns-1 md:columns-2">
                      {block.items.map((item) => (
                        <li key={item.targetId}>
                          <a
                            href={`#${item.targetId}`}
                            style={{ fontSize: "14px", color: "var(--color-teal-700)" }}
                          >
                            {item.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                );
              }

              if (block.type === "faq") {
                return (
                  <div key={`${block.type}-${index}`} className="space-y-5 my-5">
                    {block.items.map((item) => (
                      <div key={item.question}>
                        <h3
                          className="font-medium mb-2"
                          style={{ fontSize: "17px", color: "var(--color-text-primary)" }}
                        >
                          {item.question}
                        </h3>
                        <p
                          style={{
                            fontSize: "15px",
                            lineHeight: "1.75",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {item.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              }

              if (block.type === "image") {
                const webpSrc = block.src.replace(/\.(png|jpe?g)$/i, ".webp");
                return (
                  <figure key={`${block.type}-${index}`} className="my-8">
                    <div
                      className="rounded-lg border overflow-hidden"
                      style={{ borderColor: "var(--color-border-tertiary)" }}
                    >
                      <picture>
                        {webpSrc !== block.src ? (
                          <source srcSet={webpSrc} type="image/webp" />
                        ) : null}
                        <img
                          src={block.src}
                          alt={block.alt}
                          width={block.width}
                          height={block.height}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-auto"
                        />
                      </picture>
                    </div>
                    {block.caption ? (
                      <figcaption
                        className="mt-2"
                        style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}
                      >
                        {block.caption}
                      </figcaption>
                    ) : null}
                  </figure>
                );
              }

              if (block.type === "humanInput") {
                return (
                  <div
                    key={`${block.type}-${index}`}
                    className="my-6 rounded-lg border-2 border-dashed p-5"
                    style={{ borderColor: "#f59e0b", background: "#fffbeb" }}
                  >
                    <p
                      style={{
                        fontSize: "14px",
                        lineHeight: "1.65",
                        fontStyle: "italic",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      [HUMAN INPUT: {block.text}]
                    </p>
                  </div>
                );
              }

              if (block.type === "download") {
                const downloadIndex =
                  article.body
                    .slice(0, index)
                    .filter((item) => item.type === "cta" || item.type === "download")
                    .length + 1;

                return (
                  <div
                    key={`${block.type}-${index}`}
                    className="my-8 rounded-lg border p-6"
                    style={{
                      borderColor: "var(--color-border-tertiary)",
                      background: "var(--color-slate-50)",
                    }}
                  >
                    <p
                      className="font-medium mb-2"
                      style={{ fontSize: "19px", color: "var(--color-text-primary)" }}
                    >
                      {block.heading}
                    </p>
                    <p
                      className="mb-4"
                      style={{
                        fontSize: "14px",
                        lineHeight: "1.65",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {block.text}
                    </p>
                    <a
                      href={block.href}
                      download
                      onClick={() =>
                        trackBlogCtaClick({
                          article_slug: article.slug,
                          category_slug: article.categorySlug,
                          cta_index: downloadIndex,
                          cta_text: block.buttonText,
                          destination: block.href
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-md px-4 py-2"
                      style={{
                        fontSize: "14px",
                        background: "var(--color-teal-700)",
                        color: "white",
                      }}
                    >
                      <Download size={15} />
                      {block.buttonText}
                    </a>
                  </div>
                );
              }

              if (block.type === "cta") {
                const ctaIndex =
                  article.body
                    .slice(0, index)
                    .filter((item) => item.type === "cta" || item.type === "download")
                    .length + 1;

                return (
                  <div
                    key={`${block.type}-${index}`}
                    className="my-8 rounded-lg border p-6"
                    style={{
                      borderColor: "var(--color-border-tertiary)",
                      background: "var(--color-teal-50)",
                    }}
                  >
                    <p
                      className="font-medium mb-2"
                      style={{ fontSize: "19px", color: "var(--color-text-primary)" }}
                    >
                      {block.heading}
                    </p>
                    <p
                      className="mb-4"
                      style={{
                        fontSize: "14px",
                        lineHeight: "1.65",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {block.text}
                    </p>
                    <Link
                      to={block.href}
                      onClick={() =>
                        trackBlogCtaClick({
                          article_slug: article.slug,
                          category_slug: article.categorySlug,
                          cta_index: ctaIndex,
                          cta_text: block.buttonText,
                          destination: block.href
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-md px-4 py-2"
                      style={{
                        fontSize: "14px",
                        background: "var(--color-teal-700)",
                        color: "white",
                      }}
                    >
                      {block.buttonText}
                      <ArrowRight size={15} />
                    </Link>
                  </div>
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

              if (block.type === "table") {
                return (
                  <div key={`${block.type}-${index}`} className="my-6 overflow-x-auto">
                    <table
                      className="w-full border-collapse overflow-hidden rounded-lg border"
                      style={{ borderColor: "var(--color-border-tertiary)" }}
                    >
                      <thead>
                        <tr style={{ background: "var(--color-slate-50)" }}>
                          {block.headers.map((header) => (
                            <th
                              key={header}
                              className="border px-4 py-3 text-left font-medium"
                              style={{
                                borderColor: "var(--color-border-tertiary)",
                                fontSize: "13px",
                                color: "var(--color-text-primary)",
                              }}
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row) => (
                          <tr key={row.join("-")}>
                            {row.map((cell, cellIndex) => (
                              <td
                                key={`${cell}-${cellIndex}`}
                                className="border px-4 py-3"
                                style={{
                                  borderColor: "var(--color-border-tertiary)",
                                  fontSize: "14px",
                                  color: "var(--color-text-secondary)",
                                }}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }

              return (
                <p
                  key={`${block.type}-${index}`}
                  className="mb-5"
                  style={{ fontSize: "15px", lineHeight: "1.75", color: "var(--color-text-secondary)" }}
                >
                  {renderLinkedText(block.text, block.links)}
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
