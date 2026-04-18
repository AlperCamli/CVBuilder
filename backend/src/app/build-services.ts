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
import {
  SupabaseSubscriptionsRepository,
  type SubscriptionsRepository
} from "../modules/users/subscriptions.repository";
import { SupabaseUsageRepository, type UsageRepository } from "../modules/users/usage.repository";
import { UsersService } from "../modules/users/users.service";
import { SupabaseUsersRepository, type UsersRepository } from "../modules/users/users.repository";
import type { AuthProvider } from "../modules/auth/auth.types";
import { AiService } from "../modules/ai/ai.service";
import { SupabaseAiRepository, type AiRepository } from "../modules/ai/ai.repository";
import { createAiProvider } from "../modules/ai/provider/create-ai-provider";
import type { AiProvider } from "../modules/ai/provider/ai-provider";
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

export interface AppServices {
  authService: AuthService;
  usersService: UsersService;
  dashboardService: DashboardService;
  systemService: SystemService;
  masterCvService: MasterCvService;
  importsService: ImportsService;
  jobsService: JobsService;
  tailoredCvService: TailoredCvService;
  cvRevisionsService: CvRevisionsService;
  aiService: AiService;
  templatesService: TemplatesService;
  renderingService: RenderingService;
}

export interface ServiceOverrides {
  authProvider?: AuthProvider;
  usersRepository?: UsersRepository;
  subscriptionsRepository?: SubscriptionsRepository;
  usageRepository?: UsageRepository;
  dashboardRepository?: DashboardRepository;
  databaseHealthChecker?: DatabaseHealthCheckerPort;
  masterCvRepository?: MasterCvRepository;
  importsRepository?: ImportsRepository;
  jobsRepository?: JobsRepository;
  tailoredCvRepository?: TailoredCvRepository;
  cvRevisionsRepository?: CvRevisionsRepository;
  aiRepository?: AiRepository;
  aiProvider?: AiProvider;
  cvParser?: CvParser;
  templatesRepository?: TemplatesRepository;
}

export const buildDefaultServices = (
  config: AppConfig,
  _logger: Logger,
  overrides?: ServiceOverrides
): AppServices => {
  const supabaseClients = createSupabaseClients(config);

  const usersRepository =
    overrides?.usersRepository ?? new SupabaseUsersRepository(supabaseClients.serviceRoleClient);
  const subscriptionsRepository =
    overrides?.subscriptionsRepository ??
    new SupabaseSubscriptionsRepository(supabaseClients.serviceRoleClient);
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
  const tailoredCvRepository =
    overrides?.tailoredCvRepository ?? new SupabaseTailoredCvRepository(supabaseClients.serviceRoleClient);
  const cvRevisionsRepository =
    overrides?.cvRevisionsRepository ??
    new SupabaseCvRevisionsRepository(supabaseClients.serviceRoleClient);
  const aiRepository = overrides?.aiRepository ?? new SupabaseAiRepository(supabaseClients.serviceRoleClient);
  const aiProvider = overrides?.aiProvider ?? createAiProvider(config);
  const templatesRepository =
    overrides?.templatesRepository ?? new SupabaseTemplatesRepository(supabaseClients.serviceRoleClient);
  const cvParser = overrides?.cvParser ?? new SimpleCvParser();

  const authService = new AuthService(authProvider, usersRepository);
  const usersService = new UsersService(usersRepository, subscriptionsRepository, usageRepository);
  const dashboardService = new DashboardService(usersService, dashboardRepository);
  const systemService = new SystemService(config, databaseHealthChecker);
  const templatesService = new TemplatesService(templatesRepository);
  const renderingService = new RenderingService(templatesService);
  const masterCvService = new MasterCvService(masterCvRepository, templatesService, renderingService);
  const importsService = new ImportsService(importsRepository, masterCvRepository, cvParser);
  const jobsService = new JobsService(jobsRepository);
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
    config.ai.promptProfile
  );

  return {
    authService,
    usersService,
    dashboardService,
    systemService,
    masterCvService,
    importsService,
    jobsService,
    tailoredCvService,
    cvRevisionsService,
    aiService,
    templatesService,
    renderingService
  };
};
