// Admin-only: proxy.ts rejects requests without the admin cookie.
import { resumeRunStream } from "@/lib/chat-route";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return resumeRunStream(request, (await params).id, adminChatFlow);
}
