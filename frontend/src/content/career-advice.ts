import content from "./career-advice-content.json";

export type ArticleTextLink = {
  text: string;
  href: string;
};

export type ArticleBodyBlock =
  | {
      type: "paragraph" | "heading";
      text: string;
      links?: ArticleTextLink[];
    }
  | {
      type: "list";
      items: string[];
    }
  | {
      type: "table";
      headers: string[];
      rows: string[][];
    }
  | {
      type: "cta";
      heading: string;
      text: string;
      buttonText: string;
      href: string;
    };

export type CareerArticle = {
  slug: string;
  title: string;
  description: string;
  categorySlug: string;
  priorityRule: string;
  publishedDate: string;
  updatedDate: string;
  readingTime: string;
  heroImage: string;
  body: ArticleBodyBlock[];
};

export type CareerCategory = {
  slug: string;
  name: string;
  navLabel: string;
  description: string;
};

type CareerAdviceContent = {
  categories: CareerCategory[];
  articles: CareerArticle[];
};

const careerAdviceContent = content as CareerAdviceContent;

export const CAREER_CATEGORIES = careerAdviceContent.categories;

export const CAREER_ARTICLES = careerAdviceContent.articles.map((article) => ({
  ...article,
  category: getCareerCategory(article.categorySlug)?.name ?? article.categorySlug,
}));

export type CareerArticleWithCategory = CareerArticle & {
  category: string;
};

export function getCareerCategory(slug: string | undefined) {
  return CAREER_CATEGORIES.find((category) => category.slug === slug);
}

export function getCareerArticlesByCategory(categorySlug: string | undefined) {
  return CAREER_ARTICLES.filter((article) => article.categorySlug === categorySlug);
}

export function getCareerArticle(categorySlug: string | undefined, slug: string | undefined) {
  return CAREER_ARTICLES.find(
    (article) => article.categorySlug === categorySlug && article.slug === slug
  );
}

export function getCareerArticlePath(article: Pick<CareerArticle, "categorySlug" | "slug">) {
  return `/career-advice/${article.categorySlug}/${article.slug}`;
}

export function getCareerCategoryPath(category: Pick<CareerCategory, "slug">) {
  return `/career-advice/${category.slug}`;
}
