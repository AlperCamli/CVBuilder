import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { TailoringService } from "./tailoring.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class TailoringController {
  constructor(private readonly tailoringService: TailoringService) {}

  createSession = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.createSession(requireSession(request), request.body);
    sendSuccess(response, data, { statusCode: 201 });
  });

  getActiveSession = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.getActiveSessionForCv(
      requireSession(request),
      String(request.query.tailored_cv_id)
    );
    sendSuccess(response, { session: data });
  });

  getSession = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.getSession(requireSession(request), request.params.sessionId);
    sendSuccess(response, data);
  });

  analyze = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.analyze(requireSession(request), request.params.sessionId);
    sendSuccess(response, data);
  });

  setRequirementDecision = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.setRequirementDecision(
      requireSession(request),
      request.params.sessionId,
      request.params.requirementId,
      request.body.decision
    );
    sendSuccess(response, data);
  });

  answerQuestion = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.answerQuestion(
      requireSession(request),
      request.params.sessionId,
      request.params.questionId,
      {
        answer: request.body.answer,
        detail: request.body.detail ?? null,
        add_to_main: request.body.add_to_main === true
      }
    );
    sendSuccess(response, data);
  });

  completeQuestions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.completeQuestions(requireSession(request), request.params.sessionId);
    sendSuccess(response, data);
  });

  runTask = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.runTask(
      requireSession(request),
      request.params.sessionId,
      request.params.taskId,
      { regenerate: request.body?.regenerate, refinement: request.body?.refinement ?? null }
    );
    sendSuccess(response, data);
  });

  decideSuggestion = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.decideSuggestion(
      requireSession(request),
      request.params.sessionId,
      request.params.suggestionId,
      request.body
    );
    sendSuccess(response, data);
  });

  finish = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.finish(requireSession(request), request.params.sessionId);
    sendSuccess(response, data);
  });

  updatePreferences = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.updatePreferences(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  listAdminSessions = asyncHandler(async (request: Request, response: Response) => {
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 50;
    const data = await this.tailoringService.listAdminSessions(limit);
    sendSuccess(response, { sessions: data });
  });

  getAdminCostReport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoringService.getCostReport(request.params.sessionId);
    sendSuccess(response, data);
  });
}
