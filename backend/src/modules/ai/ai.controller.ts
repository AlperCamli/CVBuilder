import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { AiService } from "./ai.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class AiController {
  constructor(private readonly aiService: AiService) {}

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

  postBlockSuggest = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.suggestBlock(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postBlockCompare = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.compareBlock(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  postBlockOptions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.aiService.generateBlockOptions(requireSession(request), request.body);
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
