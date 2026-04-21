import type { Logger } from "pino";
import type { AppConfig } from "../shared/config/env";
import {
  DatabaseHealthChecker,
  type DatabaseHealthCheckerPort
} from "../shared/db/database-health";
import { createSupabaseClients } from "../shared/db/supabase";
import { AuthService } from "../modules/auth/auth.service";
import { SupabaseAuthProvider } from "../modules/auth/supabase-auth-provider";
import { DashboardService } from "../modules/dashboard/dashboard.service";
import {
  SupabaseDashboardRepository,
  type DashboardRepository
} from "../modules/dashboard/dashboard.repository";
import { ImportsService } from "../modules/imports/imports.service";
import {
  SupabaseImportsRepository,
  type ImportsRepository
} from "../modules/imports/imports.repository";
import { SimpleCvParser } from "../modules/imports/parsers/simple-cv-parser";
import type { CvParser } from "../modules/imports/parsers/cv-parser";
import { JobsService } from "../modules/jobs/jobs.service";
import { SupabaseJobsRepository, type JobsRepository } from "../modules/jobs/jobs.repository";
import { CoverLettersService } from "../modules/cover-letters/cover-letters.service";
import {
  SupabaseCoverLettersRepository,
  type CoverLettersRepository
} from "../modules/cover-letters/cover-letters.repository";
import { MasterCvService } from "../modules/master-cv/master-cv.service";
import {
  SupabaseMasterCvRepository,
  type MasterCvRepository
} from "../modules/master-cv/master-cv.repository";
import { SystemService } from "../modules/system/system.service";
import { TailoredCvService } from "../modules/tailored-cv/tailored-cv.service";
import {
  SupabaseTailoredCvRepository,
  type TailoredCvRepository
} from "../modules/tailored-cv/tailored-cv.repository";
import { UsersService } from "../modules/users/users.service";
import { SupabaseUsersRepository, type UsersRepository } from "../modules/users/users.repository";
import type { AuthProvider } from "../modules/auth/auth.types";
import { AiService } from "../modules/ai/ai.service";
import { SupabaseAiRepository, type AiRepository } from "../modules/ai/ai.repository";
import { createAiProvider } from "../modules/ai/provider/create-ai-provider";
import type { AiProvider } from "../modules/ai/provider/ai-provider";
import {
  SupabaseAiPromptConfigRepository,
  type AiPromptConfigRepository
} from "../modules/ai/prompts/prompt-config.repository";
import { AiPromptResolver } from "../modules/ai/prompts/prompt-resolver";
import { CvRevisionsService } from "../modules/cv-revisions/cv-revisions.service";
import {
  SupabaseCvRevisionsRepository,
  type CvRevisionsRepository
} from "../modules/cv-revisions/cv-revisions.repository";
import { TemplatesService } from "../modules/templates/templates.service";
import {
  SupabaseTemplatesRepository,
  type TemplatesRepository
} from "../modules/templates/templates.repository";
import { RenderingService } from "../modules/rendering/rendering.service";
import { FilesService } from "../modules/files/files.service";
import { SupabaseFilesRepository, type FilesRepository } from "../modules/files/files.repository";
import { ExportsService } from "../modules/exports/exports.service";
import {
  SupabaseExportsRepository,
  type ExportsRepository
} from "../modules/exports/exports.repository";
import {
  DefaultRenderingExportGenerator,
  type RenderingExportGenerator
} from "../modules/exports/generators/rendering-export-generator";
import { BillingService } from "../modules/billing/billing.service";
import {
  SupabaseBillingSubscriptionsRepository,
  type BillingSubscriptionsRepository
} from "../modules/billing/subscriptions.repository";
import {
  StripeBillingGateway,
  type StripeGateway
} from "../modules/billing/stripe-gateway";
import { createPlanCatalog } from "../modules/entitlements/plan-definitions";
import { EntitlementsService } from "../modules/entitlements/entitlements.service";
import { SupabaseUsageRepository, type UsageRepository } from "../modules/usage/usage.repository";
import { UsageService } from "../modules/usage/usage.service";

export interface AppServices {
  authService: AuthService;
  usersService: UsersService;
  dashboardService: DashboardService;
  systemService: SystemService;
  masterCvService: MasterCvService;
  importsService: ImportsService;
  jobsService: JobsService;
  coverLettersService: CoverLettersService;
  tailoredCvService: TailoredCvService;
  cvRevisionsService: CvRevisionsService;
  aiService: AiService;
  templatesService: TemplatesService;
  renderingService: RenderingService;
  filesService: FilesService;
  exportsService: ExportsService;
  billingService: BillingService;
}

export interface ServiceOverrides {
  authProvider?: AuthProvider;
  usersRepository?: UsersRepository;
  billingSubscriptionsRepository?: BillingSubscriptionsRepository;
  usageRepository?: UsageRepository;
  dashboardRepository?: DashboardRepository;
  databaseHealthChecker?: DatabaseHealthCheckerPort;
  masterCvRepository?: MasterCvRepository;
  importsRepository?: ImportsRepository;
  jobsRepository?: JobsRepository;
  coverLettersRepository?: CoverLettersRepository;
  tailoredCvRepository?: TailoredCvRepository;
  cvRevisionsRepository?: CvRevisionsRepository;
  aiRepository?: AiRepository;
  aiProvider?: AiProvider;
  aiPromptConfigRepository?: AiPromptConfigRepository;
  cvParser?: CvParser;
  templatesRepository?: TemplatesRepository;
  filesRepository?: FilesRepository;
  exportsRepository?: ExportsRepository;
  renderingExportGenerator?: RenderingExportGenerator;
  stripeGateway?: StripeGateway | null;
  entitlementsService?: EntitlementsService;
  usageService?: UsageService;
  billingService?: BillingService;
}

export const buildDefaultServices = (
  config: AppConfig,
  _logger: Logger,
  overrides?: ServiceOverrides
): AppServices => {
  const supabaseClients = createSupabaseClients(config);

  const usersRepository =
    overrides?.usersRepository ?? new SupabaseUsersRepository(supabaseClients.serviceRoleClient);
  const billingSubscriptionsRepository =
    overrides?.billingSubscriptionsRepository ??
    new SupabaseBillingSubscriptionsRepository(supabaseClients.serviceRoleClient);
  const usageRepository =
    overrides?.usageRepository ?? new SupabaseUsageRepository(supabaseClients.serviceRoleClient);

  const authProvider =
    overrides?.authProvider ?? new SupabaseAuthProvider(supabaseClients.serviceRoleClient);
  const dashboardRepository =
    overrides?.dashboardRepository ?? new SupabaseDashboardRepository(supabaseClients.serviceRoleClient);
  const databaseHealthChecker =
    overrides?.databaseHealthChecker ?? new DatabaseHealthChecker(supabaseClients.serviceRoleClient);
  const masterCvRepository =
    overrides?.masterCvRepository ?? new SupabaseMasterCvRepository(supabaseClients.serviceRoleClient);
  const importsRepository =
    overrides?.importsRepository ?? new SupabaseImportsRepository(supabaseClients.serviceRoleClient);
  const jobsRepository =
    overrides?.jobsRepository ?? new SupabaseJobsRepository(supabaseClients.serviceRoleClient);
  const coverLettersRepository =
    overrides?.coverLettersRepository ??
    new SupabaseCoverLettersRepository(supabaseClients.serviceRoleClient);
  const tailoredCvRepository =
    overrides?.tailoredCvRepository ?? new SupabaseTailoredCvRepository(supabaseClients.serviceRoleClient);
  const cvRevisionsRepository =
    overrides?.cvRevisionsRepository ??
    new SupabaseCvRevisionsRepository(supabaseClients.serviceRoleClient);
  const aiRepository = overrides?.aiRepository ?? new SupabaseAiRepository(supabaseClients.serviceRoleClient);
  const aiPromptConfigRepository =
    overrides?.aiPromptConfigRepository ??
    new SupabaseAiPromptConfigRepository(supabaseClients.serviceRoleClient);
  const aiProvider = overrides?.aiProvider ?? createAiProvider(config);
  const aiPromptResolver = new AiPromptResolver(
    aiPromptConfigRepository,
    config.ai.promptProfile
  );
  const templatesRepository =
    overrides?.templatesRepository ?? new SupabaseTemplatesRepository(supabaseClients.serviceRoleClient);
  const filesRepository =
    overrides?.filesRepository ?? new SupabaseFilesRepository(supabaseClients.serviceRoleClient);
  const exportsRepository =
    overrides?.exportsRepository ?? new SupabaseExportsRepository(supabaseClients.serviceRoleClient);
  const renderingExportGenerator =
    overrides?.renderingExportGenerator ?? new DefaultRenderingExportGenerator();
  const cvParser = overrides?.cvParser ?? new SimpleCvParser();

  const entitlementsService =
    overrides?.entitlementsService ??
    new EntitlementsService(createPlanCatalog({ proStripePriceId: config.billing.stripeProPriceId }));
  const usageService = overrides?.usageService ?? new UsageService(usageRepository);
  const stripeGateway =
    overrides?.stripeGateway === undefined
      ? config.billing.stripeSecretKey
        ? new StripeBillingGateway(config.billing.stripeSecretKey)
        : null
      : overrides.stripeGateway;

  const billingService =
    overrides?.billingService ??
    new BillingService(
      usersRepository,
      billingSubscriptionsRepository,
      usageService,
      entitlementsService,
      stripeGateway,
      {
        provider: config.billing.provider,
        checkoutSuccessUrl: config.billing.checkoutSuccessUrl,
        checkoutCancelUrl: config.billing.checkoutCancelUrl,
        portalReturnUrl: config.billing.portalReturnUrl,
        stripeWebhookSecret: config.billing.stripeWebhookSecret
      }
    );

  const authService = new AuthService(authProvider, usersRepository);
  const usersService = new UsersService(usersRepository, billingService);
  const dashboardService = new DashboardService(usersService, dashboardRepository);
  const systemService = new SystemService(config, databaseHealthChecker);
  const templatesService = new TemplatesService(templatesRepository);
  const renderingService = new RenderingService(templatesService);
  const filesService = new FilesService(filesRepository, {
    storageBucket: config.exports.storageBucket,
    downloadUrlTtlSeconds: config.exports.downloadUrlTtlSeconds
  });
  const masterCvService = new MasterCvService(masterCvRepository, templatesService, renderingService);
  const importsService = new ImportsService(importsRepository, masterCvRepository, cvParser);
  const jobsService = new JobsService(jobsRepository);
  const coverLettersService = new CoverLettersService(
    coverLettersRepository,
    jobsRepository,
    filesService,
    billingService
  );
  const cvRevisionsService = new CvRevisionsService(cvRevisionsRepository, tailoredCvRepository);
  const tailoredCvService = new TailoredCvService(
    tailoredCvRepository,
    masterCvRepository,
    jobsRepository,
    cvRevisionsService,
    templatesService,
    renderingService
  );
  const aiService = new AiService(
    aiRepository,
    aiProvider,
    masterCvRepository,
    tailoredCvRepository,
    jobsRepository,
    cvRevisionsService,
    templatesService,
    aiPromptResolver,
    billingService
  );
  const exportsService = new ExportsService(
    exportsRepository,
    tailoredCvRepository,
    templatesService,
    renderingService,
    filesService,
    renderingExportGenerator,
    billingService
  );

  return {
    authService,
    usersService,
    dashboardService,
    systemService,
    masterCvService,
    importsService,
    jobsService,
    coverLettersService,
    tailoredCvService,
    cvRevisionsService,
    aiService,
    templatesService,
    renderingService,
    filesService,
    exportsService,
    billingService
  };
};
