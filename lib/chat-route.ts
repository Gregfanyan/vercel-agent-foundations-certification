/**
 * Request handling shared by the shopping and admin chat routes.
 * Server-only: imported by route handlers, never by workflows or the client.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, validateUIMessages, type UIMessage } from "ai";
import { getRun, type Run } from "workflow/api";

const MAX_BODY_CHARS = 400_000;
const MAX_MESSAGES = 100;
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const invalid = (error: string, status = 400) =>
  Response.json({ error }, { status });

/** Parse and validate `{ id, messages }` from the client. */
export async function parseChatRequest(
  request: Request,
): Promise<{ chatId: string; messages: UIMessage[] } | Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return invalid("Conversation too long", 413);

  let body: { id?: unknown; messages?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return invalid("Invalid JSON");
  }
  if (typeof body.id !== "string" || !CHAT_ID.test(body.id)) {
    return invalid("Invalid chat id");
  }
  if (
    !Array.isArray(body.messages) ||
    body.messages.length === 0 ||
    body.messages.length > MAX_MESSAGES
  ) {
    return invalid("Invalid messages");
  }

  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: body.messages });
  } catch {
    return invalid("Invalid messages");
  }
  // Clients may only speak as the user (no injected system prompts), and
  // every turn must end with a user message.
  if (messages.some((m) => m.role === "system") || messages.at(-1)?.role !== "user") {
    return invalid("Invalid messages");
  }
  return { chatId: body.id, messages };
}

export function streamRun(run: Run<unknown>, uiStartIndex = 0) {
  return createUIMessageStreamResponse({
    stream: run
      .getReadable({ startIndex: 0 })
      .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex })),
    headers: { "x-workflow-run-id": run.runId },
  });
}

/**
 * GET handler body for `{api}/{runId}/stream`. Replays the durable stream
 * (raw parts from 0, UI chunks from `startIndex`), so reconnecting never
 * re-runs work. Only runs of `workflow` are served, which keeps the shopping
 * and admin conversations from reading each other's streams.
 */
export async function resumeRunStream(
  request: Request,
  runId: string,
  workflow: unknown,
) {
  const startIndex = Number(
    new URL(request.url).searchParams.get("startIndex") ?? "0",
  );
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return invalid("startIndex must be a non-negative integer");
  }
  const run = getRun(runId);
  try {
    // `workflowId` is injected by the Workflow compiler. It can be absent in
    // Next's dev module wrapper, where the durable name is still the function
    // name. Accept that exact fallback, never an arbitrary run.
    const expected = (workflow as { workflowId?: string; name?: string }).workflowId;
    const actual = await run.workflowName;
    if (actual !== expected && actual !== (workflow as { name?: string }).name) {
      throw new Error();
    }
  } catch {
    return invalid("Chat stream not found", 404);
  }
  return streamRun(run, startIndex);
}
