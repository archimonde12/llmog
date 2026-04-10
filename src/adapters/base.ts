import { OpenAIChatCompletionsRequest } from "../types";

export type AdapterResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type AdapterStreamResult = {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
};

export type LlmAdapter = {
  chatCompletions(req: OpenAIChatCompletionsRequest): Promise<AdapterResult>;
  chatCompletionsStream?(
    req: OpenAIChatCompletionsRequest,
  ): Promise<AdapterStreamResult>;
};

