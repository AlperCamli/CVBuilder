import type { ApiClient, RequestOptions } from "../../integration/api-client";
import { ApiClientError } from "../../integration/api-error";
import type {
  CvContent,
  MasterCvDetail,
  TailoredCvDetail,
  JobSummary,
  CoverLetterDetail,
  MeResponseData,
  RenderingPresentation,
} from "../../integration/api-types";
import { DEMO_TEMPLATES } from "../../pages/designs/product-demo-data";
import { translateInLocale } from "../i18n";
import { createDemoTailoring } from "./demo-tailoring";

export type DemoState = "populated" | "empty" | "loading" | "error";
export type DemoPlan = "free" | "monthly";
const stamp = "2026-10-10T12:00:00.000Z";
const statuses = [
  "saved",
  "applied",
  "interview",
  "offer",
  "rejected",
  "archived",
] as const;

export function sampleContent(language: "en" | "tr"): CvContent {
  const tr = language === "tr";
  const fields = [
    [
      "header",
      {
        full_name: "Deniz Yılmaz",
        headline: tr ? "Veri Analisti" : "Data Analyst",
        email: "deniz@example.invalid",
        location: "İstanbul, Türkiye",
      },
    ],
    [
      "summary",
      {
        text: tr
          ? "Satış verilerini anlaşılır raporlara dönüştüren veri analisti. Excel, SQL ve ekipler arası iş birliği konusunda deneyimli."
          : "Data analyst turning sales data into clear reports. Experienced in Excel, SQL and collaboration across teams.",
      },
    ],
    [
      "experience",
      {
        role: tr ? "Veri Analisti" : "Data Analyst",
        company: "Example Studio",
        start_date: "2023-01",
        end_date: "",
        current_role: true,
        location: "İstanbul",
        description: tr
          ? "Haftalık satış raporları hazırlayarak raporlama süresini %30 azalttı."
          : "Prepared weekly sales reports, reducing reporting time by 30%.",
      },
    ],
    [
      "education",
      {
        institution: "Example University",
        degree: tr ? "İşletme Lisansı" : "BSc Business Management",
        start_date: "2019",
        end_date: "2023",
      },
    ],
    [
      "skills",
      {
        skills: [
          "Excel",
          "SQL",
          "Python",
          tr ? "Veri görselleştirme" : "Data visualization",
        ],
      },
    ],
  ] as const;
  return {
    version: "v1",
    language,
    metadata: {
      full_name: "Deniz Yılmaz",
      headline: tr ? "Veri Analisti" : "Data Analyst",
      email: "deniz@example.invalid",
      location: "İstanbul, Türkiye",
    },
    sections: fields.map(([type, values], order) => ({
      id: `demo-${language}-${type}`,
      type,
      title: null,
      order,
      meta: {},
      blocks: [
        {
          id: `demo-${language}-${type}-block`,
          type,
          order: 0,
          visibility: "visible",
          fields: JSON.parse(JSON.stringify(values)),
          meta: {},
        },
      ],
    })),
  };
}
function master(
  language: "en" | "tr",
  id = `demo-master-${language}`,
): MasterCvDetail {
  const content = sampleContent(language);
  return {
    id,
    title: language === "tr" ? "Deniz — Türkçe CV" : "Deniz — English CV",
    language,
    source_type: "scratch",
    template_id: "demo-template-0",
    module_type: "standard",
    created_at: stamp,
    updated_at: stamp,
    summary_text: null,
    current_content: content,
    preview: {
      version: "v1",
      language,
      generated_at: stamp,
      plain_text: "Deniz Yılmaz",
      sections: content.sections,
    },
  };
}
function preview(content: CvContent, templateId?: string | null) {
  const heading =
    content.sections.find((s) => s.type === "header")?.blocks[0]?.fields ??
    content.metadata;
  const text = (value: unknown) =>
    Array.isArray(value)
      ? value.join(", ")
      : value == null
        ? ""
        : String(value);
  const presentation: RenderingPresentation = {
    version: "v1",
    language: content.language,
    document_title: "Deniz Yılmaz",
    theme: DEMO_TEMPLATES[Number(templateId?.split("-").at(-1)) || 0],
    header: {
      name: text(heading.full_name ?? content.metadata.full_name),
      title: text(heading.headline ?? content.metadata.headline),
      email: text(heading.email ?? content.metadata.email),
      phone: null,
      location: text(heading.location ?? content.metadata.location),
      photo: null,
      photo_shape: "circle",
      photo_position: "left",
      contact_items: ["deniz@example.invalid", "İstanbul, Türkiye"],
      social_links: [],
    },
    sections: content.sections
      .filter((s) => s.type !== "header" && !s.meta.hidden)
      .map((s) => ({
        id: s.id,
        type: s.type,
        title:
          s.title ||
          translateInLocale(
            s.type === "summary"
              ? "Professional Summary"
              : s.type === "experience"
                ? "Work Experience"
                : s.type === "education"
                  ? "Education"
                  : "Skills",
            content.language === "tr" ? "tr" : "en",
          ),
        inline_text: ["summary", "skills"].includes(s.type)
          ? s.blocks
              .map((b) => text(b.fields.text ?? b.fields.skills))
              .join("\n")
          : null,
        items: ["summary", "skills"].includes(s.type)
          ? []
          : s.blocks
              .filter((b) => b.visibility !== "hidden")
              .map((b) => ({
                id: b.id,
                title: text(b.fields.role ?? b.fields.degree),
                subtitle: text(b.fields.company ?? b.fields.institution),
                date_range: text(b.fields.start_date),
                location: text(b.fields.location),
                metadata_line: null,
                body: text(b.fields.description),
                bullets: [],
              })),
      })),
  };
  const template = {
    id: templateId ?? "demo-template-0",
    name: presentation.theme.template_name,
    slug: presentation.theme.template_slug,
    status: "active",
    module_type: "standard",
    preview_config: null,
    export_config: null,
    created_at: stamp,
    updated_at: stamp,
  };
  return {
    current_content: content,
    resolved_template: { resolution: "selected", template },
    presentation,
    rendering: { version: "v1", sections: [], plain_text: "Deniz Yılmaz" },
  };
}

/** Each iframe owns a separate store; unhandled operations fail closed. */
export function createDemoStore(
  state: DemoState = "populated",
  plan: DemoPlan = "monthly",
  market: "TR" | "GLOBAL" = "TR",
) {
  const limits = {
    tailored_cv_generations: plan === "free" ? 3 : 50,
    exports: 50,
    ai_actions: 50,
    storage_bytes: 100000000,
  };
  const me: MeResponseData = {
    user: {
      id: "demo-user",
      auth_user_id: "demo-auth",
      email: "deniz@example.invalid",
      full_name: "Deniz Yılmaz",
      locale: "tr",
      default_cv_language: "en",
      onboarding_completed: true,
      onboarding_state: { completed_at: stamp },
      created_at: stamp,
      updated_at: stamp,
    },
    current_plan: {
      plan_code: plan,
      status: plan === "free" ? "free" : "active",
      current_period_start: stamp,
      current_period_end: "2026-11-10T12:00:00Z",
      cancel_at_period_end: false,
    },
    usage_summary: {
      period_month: "2026-10",
      tailored_cv_generations_count: 2,
      exports_count: 1,
      ai_actions_count: 2,
      storage_bytes_used: 1000,
      plan_code: plan,
      limits,
      remaining: limits,
    },
    entitlements: {
      plan_code: plan,
      can_generate_tailored_cv: true,
      can_export_pdf: true,
      can_export_docx: true,
      can_use_ai_actions: true,
      limits,
      remaining: limits,
    },
  };
  const masters = new Map<string, MasterCvDetail>(
    [master("en"), master("tr")].map((cv) => [cv.id, cv]),
  );
  const jobs: JobSummary[] = statuses
    .slice(0, 4)
    .map((status, i) => ({
      id: `demo-job-${i}`,
      company_name: [
        "Example Studio",
        "Sample Analytics",
        "Demo Labs",
        "Example Works",
      ][i],
      job_title: [
        "Data Analyst",
        "Business Analyst",
        "Product Analyst",
        "Reporting Analyst",
      ][i],
      status,
      job_posting_url: null,
      location_text: "İstanbul / Remote",
      tailored_cv_id: `demo-tailored-${i}`,
      tailored_cv_title: `Deniz — ${i === 1 ? "Türkçe" : "English"}`,
      cover_letter_id: `demo-letter-${i}`,
      created_at: stamp,
      updated_at: stamp,
      applied_at: status === "saved" ? null : stamp,
    }));
  const tailored = new Map<string, TailoredCvDetail>(
    jobs.map((job, i) => {
      const source = masters.get(
        i === 1 ? "demo-master-tr" : "demo-master-en",
      )!;
      return [
        job.tailored_cv_id!,
        {
          ...structuredClone(source),
          id: job.tailored_cv_id!,
          title: `${job.company_name} — ${job.job_title}`,
          status: "ready",
          master_cv_id: source.id,
          job_id: job.id,
          job,
          ai_generation_status: "completed",
          last_exported_at: null,
          source_master_cv: source,
        },
      ];
    }),
  );
  const letters = new Map<string, CoverLetterDetail>(
    jobs.map((job, i) => [
      job.cover_letter_id!,
      {
        id: job.cover_letter_id!,
        job_id: job.id,
        tailored_cv_id: job.tailored_cv_id,
        title: `${job.company_name} — Cover letter`,
        language: i === 1 ? "tr" : "en",
        content:
          i === 1
            ? "Sayın Yetkili,\n\nVeri analizi deneyimimle ekibinize katkıda bulunmak istiyorum. Excel ve SQL ile raporlama süreçlerini geliştirdim.\n\nSaygılarımla,\nDeniz Yılmaz"
            : "Dear Hiring Team,\n\nI would like to contribute my data analysis experience to your team. I improved reporting processes using Excel and SQL.\n\nKind regards,\nDeniz Yılmaz",
        status: "ready",
        last_exported_at: null,
        created_at: stamp,
        updated_at: stamp,
        job: {
          ...job,
          job_description: "Analyze sales data using SQL and Excel.",
        },
      },
    ]),
  );
  if (state === "empty") {
    masters.clear();
    tailored.clear();
    jobs.splice(0);
    letters.clear();
  }
  const tailoringDemo = createDemoTailoring({ masters, tailored });
  const preferences = {
    analytics: false,
    ai_processing: true,
    privacy_revision: 1,
  };
  const settings = () => ({
    locale: me.user.locale,
    default_cv_language: me.user.default_cv_language,
    onboarding_completed: me.user.onboarding_completed,
    onboarding_state: me.user.onboarding_state,
  });
  const counts = () =>
    Object.fromEntries(
      statuses.map((status) => [
        status,
        jobs.filter((job) => job.status === status).length,
      ]),
    );
  const jobDetail = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) throw new Error("The requested item was not found.");
    return {
      job,
      job_description:
        "Analyze sales data using SQL and Excel. Collaborate with product teams.",
      notes: "Sample application for translation preview.",
      linked_tailored_cv: tailored.get(job.tailored_cv_id ?? "") ?? null,
      status_last_changed_at: stamp,
    };
  };
  const request = async (
    method: string,
    raw: string,
    input?: unknown,
    options?: RequestOptions,
  ): Promise<unknown> => {
    const url = new URL(raw, "https://demo.invalid"),
      path = url.pathname;
    const body = (input ?? {}) as Record<string, unknown>;
    if (options?.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    if (path === "/privacy/config")
      return {
        notice_version: "2026-10-06.2",
        controller: "Demo operator",
        address: "Demo address",
        contact: "demo@example.invalid",
        analytics_enabled: false,
        collection_enabled: true,
        ai_enabled: true,
        ai_required: true,
        ai_provider: "Demo provider",
        processors: [],
      };
    if (path === "/me/privacy") {
      if (method !== "GET") Object.assign(preferences, body);
      return preferences;
    }
    if (path === "/me") {
      if (method === "PATCH") {
        Object.assign(me.user, body);
        return { user: me.user };
      }
      return me;
    }
    if (path === "/me/settings") {
      if (method !== "GET") Object.assign(me.user, body);
      return { settings: settings() };
    }
    if (["/me/usage", "/billing/usage"].includes(path)) return me.usage_summary;
    if (path === "/billing/entitlements") return me.entitlements;
    if (path === "/billing/plan")
      return {
        ...me.current_plan,
        subscription_status: me.current_plan.status,
        trial_eligible: plan === "free",
        provider: {
          provider: "stripe",
          provider_customer_id: null,
          provider_subscription_id: null,
        },
        entitlement_summary: me.entitlements,
      };
    if (
      path === "/me/privacy/deletion" ||
      path.startsWith("/billing/checkout") ||
      path === "/billing/portal" ||
      path.includes("upload-url") ||
      (path.includes("/exports/") && method === "POST")
    )
      throw new ApiClientError({
        status: 409,
        code: "STUDIO_DEMO_ONLY",
        message: "Demo mode: payments, uploads and exports are disabled.",
      });
    const exempt = path === "/templates" || path.startsWith("/templates/");
    if (!exempt && state === "loading")
      return new Promise((_, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    if (!exempt && state === "error")
      throw new ApiClientError({
        status: 503,
        code: "DEMO_ERROR",
        message: "We couldn't complete this action. Please retry.",
      });
    if (path === "/billing/prices")
      return {
        market,
        currency: market === "TR" ? "try" : "usd",
        available: true,
        quote: "demo-only-never-valid-for-checkout",
        plans: ["weekly", "monthly", "annual"].map((code, i) => ({
          code,
          amount: (market === "TR" ? [9900, 24900, 149900] : [499, 1499, 9999])[
            i
          ],
          interval: ["week", "month", "year"][i],
          interval_count: 1,
          trial_days: i === 0 ? 3 : 0,
        })),
      };
    if (path === "/dashboard")
      return {
        user_summary: me.user,
        current_plan: me.current_plan,
        usage_summary: me.usage_summary,
        entitlements: me.entitlements,
        master_cv_summary: {
          total_count: masters.size,
          primary_master_cv: [...masters.values()][0] ?? null,
        },
        tailored_cv_summary: {
          total_count: tailored.size,
          recent_items: [...tailored.values()],
        },
        jobs_summary: {
          total_count: jobs.length,
          counts_by_status: counts(),
          recent_items: jobs,
        },
        recent_activity: [],
        locale: me.user.locale,
        onboarding_completed: true,
      };
    if (path === "/dashboard/activity") return { activity: [] };
    if (path === "/jobs/board")
      return {
        groups: statuses.map((status) => ({
          status,
          count: jobs.filter((j) => j.status === status).length,
          items: jobs.filter((j) => j.status === status),
        })),
        counts_by_status: counts(),
        total: jobs.length,
      };
    if (path === "/jobs") {
      const items = jobs.filter(
        (j) =>
          (!options?.query?.status || j.status === options.query.status) &&
          (!options?.query?.search ||
            `${j.company_name} ${j.job_title}`
              .toLowerCase()
              .includes(String(options.query.search).toLowerCase())),
      );
      return { items, page: 1, limit: 100, total: items.length };
    }
    const jobMatch = path.match(
      /^\/jobs\/([^/]+)(?:\/(status|history|cover-letter))?$/,
    );
    if (jobMatch) {
      const [, id, action] = jobMatch,
        detail = jobDetail(id);
      if (action === "status") {
        detail.job.status = body.status as JobSummary["status"];
        return { job: jobDetail(id), status_history_entry: null };
      }
      if (action === "history")
        return {
          job_id: id,
          current_status: detail.job.status,
          current_status_updated_at: stamp,
          history: [
            {
              id: `history-${id}`,
              from_status: null,
              to_status: detail.job.status,
              changed_at: stamp,
              changed_by_user_id: me.user.id,
            },
          ],
        };
      if (action === "cover-letter")
        return letters.get(detail.job.cover_letter_id!);
      if (method === "PATCH") Object.assign(detail.job, body);
      return jobDetail(id);
    }
    if (path === "/cover-letters") return { items: [...letters.values()] };
    const letterMatch = path.match(
      /^\/cover-letters\/([^/]+)(?:\/(content|exports))?$/,
    );
    if (letterMatch) {
      const letter = letters.get(letterMatch[1]);
      if (!letter) throw new Error("The requested item was not found.");
      if (letterMatch[2] === "exports")
        return { cover_letter_id: letter.id, exports: [] };
      if (method === "PUT") Object.assign(letter, body);
      return letter;
    }
    if (path === "/ai/cover-letters/generate")
      return {
        title: `${body.company_name ?? "Example Studio"} — Cover letter`,
        content:
          [...letters.values()].find((l) => l.language === body.language)
            ?.content ??
          [...letters.values()][0]?.content ??
          "Demo cover letter",
      };
    if (path === "/cv-languages") return { languages: [
      { code: "en", name: "English", direction: "ltr", section_titles: {} },
      { code: "tr", name: "Türkçe", direction: "ltr", section_titles: {} },
    ] };
    if (path === "/templates")
      return {
        templates: DEMO_TEMPLATES.map((theme, i) => ({
          id: `demo-template-${i}`,
          name: theme.template_name,
          slug: theme.template_slug,
          status: "active",
          module_type: "standard",
          preview_config: null,
          export_config: null,
          created_at: stamp,
          updated_at: stamp,
        })),
      };
    const tailoringResult = await tailoringDemo.handle(method, path, body);
    if (tailoringResult !== undefined) return tailoringResult;
    if (path === "/rendering/preview")
      return preview(
        body.current_content as CvContent,
        body.template_id as string,
      );
    if (path === "/master-cvs" || path === "/tailored-cvs") {
      if (method === "GET")
        return [...(path === "/master-cvs" ? masters : tailored).values()];
      if (method === "POST" && path === "/master-cvs") {
        const language = body.language === "tr" ? "tr" : "en",
          existing = [...masters.values()].find(
            (cv) => cv.language === language,
          );
        if (existing)
          throw new ApiClientError({
            status: 409,
            code: "MASTER_LANGUAGE_CONFLICT",
            message: "You already have a master CV in this language.",
            details: { existing_master_cv_id: existing.id },
          });
        const cv = master(language);
        cv.title = String(body.title ?? cv.title);
        masters.set(cv.id, cv);
        return cv;
      }
    }
    const cvMatch = path.match(
      /^\/(master-cvs|tailored-cvs)\/([^/]+)(?:\/(.*))?$/,
    );
    if (cvMatch) {
      const [, kind, id, action] = cvMatch,
        collection = kind === "master-cvs" ? masters : tailored;
      const cv = collection.get(id);
      if (!cv) throw new Error("The requested item was not found.");
      if (action === "ai-block-versions")
        return {
          cv_kind: kind === "master-cvs" ? "master" : "tailored",
          master_cv_id: id,
          tailored_cv_id: id,
          blocks: [],
        };
      if (action === "ai-history") return { suggestions: [], runs: [] };
      if (action === "revisions")
        return kind === "master-cvs"
          ? [
              {
                id: `demo-revision-${id}`,
                revision_number: 1,
                created_at: stamp,
                content_snapshot: sampleContent(cv.language as "en" | "tr"),
              },
            ]
          : { tailored_cv_id: id, revisions: [] };
      if (action === "exports")
        return { master_cv_id: id, tailored_cv_id: id, exports: [] };
      if (action === "source")
        return {
          tailored_cv_id: id,
          master_cv_id: (cv as TailoredCvDetail).master_cv_id,
          master_cv: masters.get((cv as TailoredCvDetail).master_cv_id),
          job: (cv as TailoredCvDetail).job,
          created_at: stamp,
          updated_at: stamp,
        };
      if (action === "preview")
        return {
          ...preview(cv.current_content, cv.template_id),
          cv,
          selected_template: preview(cv.current_content).resolved_template,
          preview: cv.preview,
        };
      if (action === "content" && method === "PUT")
        cv.current_content = structuredClone(body.current_content as CvContent);
      else if (action === "template" || (!action && method === "PATCH"))
        Object.assign(cv, body);
      else if (!action && method === "DELETE") {
        collection.delete(id);
        if (kind === "master-cvs")
          for (const [tailoredId, item] of tailored)
            if (item.master_cv_id === id) tailored.delete(tailoredId);
        return { id, is_deleted: true };
      } else if (action)
        throw new ApiClientError({
          status: 409,
          code: "STUDIO_DEMO_ONLY",
          message: "Demo mode: this action is unavailable.",
        });
      cv.preview.sections = cv.current_content.sections;
      return cv;
    }
    throw new ApiClientError({
      status: 409,
      code: "STUDIO_DEMO_ONLY",
      message: "Demo mode: this action is unavailable.",
    });
  };
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> =>
    structuredClone(await request(method, path, body, options)) as T;
  const client: ApiClient = {
    get: (path, options) => call("GET", path, undefined, options),
    delete: (path, options) => call("DELETE", path, undefined, options),
    post: (path, body, options) => call("POST", path, body, options),
    patch: (path, body, options) => call("PATCH", path, body, options),
    put: (path, body, options) => call("PUT", path, body, options),
  };
  return { client, me: () => structuredClone(me) };
}
