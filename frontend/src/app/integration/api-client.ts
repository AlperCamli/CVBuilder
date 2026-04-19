import type { ApiResponse } from "./api-types";
import { ApiClientError } from "./api-error";

export interface ApiClient {
  get<TResponse>(path: string, options?: RequestOptions): Promise<TResponse>;
  post<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    options?: RequestOptions
  ): Promise<TResponse>;
  patch<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    options?: RequestOptions
  ): Promise<TResponse>;
  put<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    options?: RequestOptions
  ): Promise<TResponse>;
  delete<TResponse>(path: string, options?: RequestOptions): Promise<TResponse>;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface CreateApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  onUnauthorized?: (error: ApiClientError) => void;
}

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>
): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const parseJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return response.json();
};

const toApiError = (status: number, payload: unknown): ApiClientError => {
  if (
    payload &&
    typeof payload === "object" &&
    "success" in payload &&
    (payload as { success?: unknown }).success === false &&
    "error" in payload
  ) {
    const errorPayload = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error;

    return new ApiClientError({
      status,
      code: errorPayload?.code ?? "UNKNOWN_ERROR",
      message: errorPayload?.message ?? "Request failed",
      details: errorPayload?.details
    });
  }

  if (payload && typeof payload === "object" && "message" in payload) {
    return new ApiClientError({
      status,
      code: "UNKNOWN_ERROR",
      message: String((payload as { message: unknown }).message)
    });
  }

  return new ApiClientError({
    status,
    code: "UNKNOWN_ERROR",
    message: typeof payload === "string" && payload.length > 0 ? payload : "Request failed"
  });
};

export const createApiClient = (options: CreateApiClientOptions): ApiClient => {
  const request = async <TResponse, TBody = unknown>(
    method: string,
    path: string,
    body?: TBody,
    requestOptions?: RequestOptions
  ): Promise<TResponse> => {
    const token = await options.getAccessToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(requestOptions?.headers ?? {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(buildUrl(options.baseUrl, path, requestOptions?.query), {
      method,
      headers,
      signal: requestOptions?.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const payload = await parseJson(response);

    if (!response.ok) {
      const error = toApiError(response.status, payload);
      if (error.isUnauthorized && options.onUnauthorized) {
        options.onUnauthorized(error);
      }
      throw error;
    }

    const envelope = payload as ApiResponse<TResponse> | TResponse;

    if (
      envelope &&
      typeof envelope === "object" &&
      "success" in envelope &&
      (envelope as { success: unknown }).success === true &&
      "data" in envelope
    ) {
      return (envelope as { data: TResponse }).data;
    }

    if (
      envelope &&
      typeof envelope === "object" &&
      "success" in envelope &&
      (envelope as { success: unknown }).success === false
    ) {
      const error = toApiError(response.status, envelope);
      if (error.isUnauthorized && options.onUnauthorized) {
        options.onUnauthorized(error);
      }
      throw error;
    }

    return envelope as TResponse;
  };

  return {
    get: <TResponse>(path: string, requestOptions?: RequestOptions) =>
      request<TResponse>("GET", path, undefined, requestOptions),
    post: <TResponse, TBody = unknown>(path: string, body?: TBody, requestOptions?: RequestOptions) =>
      request<TResponse, TBody>("POST", path, body, requestOptions),
    patch: <TResponse, TBody = unknown>(path: string, body?: TBody, requestOptions?: RequestOptions) =>
      request<TResponse, TBody>("PATCH", path, body, requestOptions),
    put: <TResponse, TBody = unknown>(path: string, body?: TBody, requestOptions?: RequestOptions) =>
      request<TResponse, TBody>("PUT", path, body, requestOptions),
    delete: <TResponse>(path: string, requestOptions?: RequestOptions) =>
      request<TResponse>("DELETE", path, undefined, requestOptions)
  };
};
