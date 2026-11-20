// Admin-only: proxy.ts rejects requests without the admin cookie.
import { start } from "workflow/api";
import { parseChatRequest, streamRun } from "@/lib/chat-route";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

export async function POST(request: Request) {
  const parsed = await parseChatRequest(request);
  if (parsed instanceof Response) return parsed;
  const run = await start(adminChatFlow, [parsed.chatId, parsed.messages]);
  return streamRun(run);
}
