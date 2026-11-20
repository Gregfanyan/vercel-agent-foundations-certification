import type { UIMessage } from "ai";
import { SHOP_INSTRUCTIONS, SHOP_MODEL, runAgentTurn } from "@/lib/agent";
import { shopTools } from "@/lib/tools";

export async function chatFlow(messages: UIMessage[]) {
  "use workflow";
  await runAgentTurn({
    model: SHOP_MODEL,
    instructions: SHOP_INSTRUCTIONS,
    tools: shopTools,
    messages,
    maxSteps: 8,
  });
}
