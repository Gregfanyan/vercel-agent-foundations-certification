import type { UIMessage } from "ai";
import { ADMIN_MODEL, adminInstructions, runAgentTurn } from "@/lib/agent";
import { createAdminTools, loadMemory } from "@/lib/tools";

export async function adminChatFlow(chatId: string, messages: UIMessage[]) {
  "use workflow";
  // Read the memory file at the start of every admin turn so notes saved
  // earlier (in this or another conversation) are always applied.
  const { available, memory } = await loadMemory();
  await runAgentTurn({
    model: ADMIN_MODEL,
    instructions: adminInstructions({
      today: new Date().toISOString().slice(0, 10),
      memory,
      memoryAvailable: available,
    }),
    tools: createAdminTools(chatId),
    messages,
    maxSteps: 20,
  });
}
