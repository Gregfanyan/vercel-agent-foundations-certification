import { start } from "workflow/api";
import { parseChatRequest, streamRun } from "@/lib/chat-route";
import { chatFlow } from "@/lib/workflows/chat-flow";

export async function POST(request: Request) {
  const parsed = await parseChatRequest(request);
  if (parsed instanceof Response) return parsed;
  const run = await start(chatFlow, [parsed.messages]);
  return streamRun(run);
}
