// ---------------------------------------------------------------------------
// Fetching a surveyed room's record
//
// One fetch, parse and check of a survey.json, with each way it can fail told
// apart so a surface can say what went wrong: the request never completed,
// the server refused it, the body was not JSON, or the record is not one the
// renderer can use. An abort is passed through untouched. Nothing is cached
// here: the caller decides how long a record lives.
// ---------------------------------------------------------------------------

import { parseSurveyRecord, SurveyRecordError, type SurveyRecord } from "./survey-record.js";

export type SurveyLoadFailure = "network" | "http" | "json" | "schema";

export class SurveyLoadError extends Error {
  readonly reason: SurveyLoadFailure;
  readonly url: string;
  /** The HTTP status, for an "http" failure. */
  readonly status: number | null;

  constructor(reason: SurveyLoadFailure, url: string, message: string, options: { readonly status?: number; readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SurveyLoadError";
    this.reason = reason;
    this.url = url;
    this.status = options.status ?? null;
  }
}

function rethrowIfAborted(signal: AbortSignal | undefined, error: unknown): void {
  if (signal?.aborted === true) throw error;
}

/** Fetches, parses and checks a survey.json; rejects with a {@link SurveyLoadError}, or the abort's reason. */
export async function fetchSurveyRecord(url: string, signal?: AbortSignal): Promise<SurveyRecord> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ?? null });
  } catch (error) {
    rethrowIfAborted(signal, error);
    throw new SurveyLoadError("network", url, `survey.json could not be fetched from ${url}`, { cause: error });
  }
  if (!response.ok) {
    throw new SurveyLoadError("http", url, `survey.json: HTTP ${String(response.status)} from ${url}`, { status: response.status });
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    rethrowIfAborted(signal, error);
    throw new SurveyLoadError("network", url, `survey.json from ${url} could not be read`, { cause: error });
  }
  signal?.throwIfAborted();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new SurveyLoadError("json", url, `survey.json from ${url} is not JSON`, { cause: error });
  }
  try {
    return parseSurveyRecord(json);
  } catch (error) {
    if (error instanceof SurveyRecordError) {
      throw new SurveyLoadError("schema", url, `${error.message} (${url})`, { cause: error });
    }
    throw error;
  }
}
