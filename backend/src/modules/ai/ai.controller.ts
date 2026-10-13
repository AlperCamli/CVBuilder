import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { AiService } from "./ai.service";
import type { RenderingService } from "../rendering/rendering.service";
import type { CvPhotosService } from "../cv-photos/cv-photos.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly renderingService: RenderingService,
    private readonly cvPhotosService: CvPhotosService
  ) {}

  getCvLanguages = asyncHandler(async (_request: Request, response: Response) => {
    sendSuccess(response, await this.aiService.listTranslationLanguages());
  });

  postTranslationStart = asyncHandler(async (request: Request, response: Response) => {
    sendSuccess(response, await this.aiService.startTranslation(requireSession(request), request.params.masterCvId, request.body.target_language, request.body.replace_master_cv_id), { statusCode: 202 });
  });
  postTranslationExecute = asyncHandler(async (request: Request, response: Response) => {
    sendSuccess(response, await this.aiService.executeTranslation(requireSession(request), request.params.masterCvId, request.params.aiRunId));
  });
  getTranslation = asyncHandler(async (request: Request, response: Response) => {
    sendSuccess(response, await this.aiService.getTranslation(requireSession(request), request.params.masterCvId, request.params.aiRunId));
  });
  getTranslationPreview = asyncHandler(async (request: Request, response: Response) => {
    const session = requireSession(request);
    const input = await this.aiService.getTranslationPreviewInput(session, request.params.masterCvId, request.params.aiRunId);
    const data = await this.renderingService.buildRendering(input);
    data.presentation.header.photo = await this.cvPhotosService.resolveSignedUrl(session.appUser.id, data.presentation.header.photo);
    sendSuccess(response, data);
  });
  postTranslationApply = asyncHandler(async (request: Request, response: Response) => {
    sendSuccess(response, await this.aiService.applyTranslationRun(requireSession(request), request.params.masterCvId, request.params.aiRunId, request.body?.replace_master_cv_id), { statusCode: 201 });
  });

  postTailoringRunStart = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.startTailoringRun(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postTailoringRunExecute = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.executeTailoringRun(
      requireSession(request),
      request.params.aiRunId
    );
    sendSuccess(response, data);
  });

  getTailoringRunStatus = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.getTailoringRunStatus(
      requireSession(request),
      request.params.aiRunId
    );
    sendSuccess(response, data);
  });

  getTailoringRunResult = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.getTailoringRunResult(
      requireSession(request),
      request.params.aiRunId
    );
    sendSuccess(response, data);
  });

  postJobAnalysis = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.analyzeJob(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postFollowUpQuestions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.generateFollowUpQuestions(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postTailoredCvDraft = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.generateTailoredCvDraft(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postImportImprove = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.improveImportedContent(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postGenerateCoverLetter = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.generateCoverLetter(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postBlockSuggest = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.suggestBlock(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  getSuggestion = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.getSuggestion(requireSession(request), request.params.suggestionId);
    sendSuccess(response, data);
  });

  postApplySuggestion = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.applySuggestion(requireSession(request), request.params.suggestionId);
    sendSuccess(response, data);
  });

  postRejectSuggestion = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.rejectSuggestion(requireSession(request), request.params.suggestionId);
    sendSuccess(response, data);
  });

  getTailoredCvAiHistory = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.getTailoredCvAiHistory(
      requireSession(request),
      request.params.tailoredCvId
    );
    sendSuccess(response, data);
  });

  getMasterCvAiHistory = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.getMasterCvAiHistory(
      requireSession(request),
      request.params.masterCvId
    );
    sendSuccess(response, data);
  });

  getTailoredCvAiBlockVersions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.getTailoredCvAiBlockVersions(
      requireSession(request),
      request.params.tailoredCvId
    );
    sendSuccess(response, data);
  });

  getMasterCvAiBlockVersions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.getMasterCvAiBlockVersions(
      requireSession(request),
      request.params.masterCvId
    );
    sendSuccess(response, data);
  });
}
