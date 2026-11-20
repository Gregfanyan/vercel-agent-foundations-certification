import { resumeRunStream } from "@/lib/chat-route";
import { chatFlow } from "@/lib/workflows/chat-flow";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return resumeRunStream(request, (await params).id, chatFlow);
}
