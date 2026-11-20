"use client";

import type { UIMessage } from "ai";
import { BarChart3 } from "lucide-react";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { ChatShell } from "@/components/chat-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useDurableChat, useIsClient } from "@/hooks/use-durable-chat";
import type { AdminUITools } from "@/lib/tools";

type AdminMessage = UIMessage<unknown, never, AdminUITools>;
type AdminPart = AdminMessage["parts"][number];
type AdminToolPart = Extract<AdminPart, { type: `tool-${string}` }>;

const SUGGESTIONS = [
  "Which products had the highest return rate in the last 30 days?",
  "Which low-stock items are also top sellers?",
  "Summarize open urgent support tickets by category",
  "Summarize revenue for the last 7 days",
];

const TITLES: Record<string, string> = {
  searchProducts: "Catalog search",
  getAllCategories: "Categories",
  getSupportTickets: "Support tickets",
  getReturnsHistory: "Returns history",
  getInventoryStock: "Inventory",
  getSalesAnalytics: "Sales analytics",
  bash: "Sandbox command",
  saveMemory: "Save to memory",
};

export function AdminAgentChat() {
  // localStorage-backed: render only after mount to avoid hydration mismatch.
  return useIsClient() ? <AdminChat /> : <Skeleton className="m-4 h-24" />;
}

function AdminChat() {
  const chat = useDurableChat<AdminMessage>("/api/admin/chat", "ship-it-shop:admin-chat");
  return (
    <ChatShell
      chat={chat}
      label="Store admin agent conversation"
      placeholder="Ask the admin agent…"
      empty={
        <ConversationEmptyState
          icon={<BarChart3 className="size-8" aria-hidden="true" />}
          title="Store Admin Agent"
          description="Read-only answers about sales, returns, inventory and support tickets. It can't change orders, stock or refunds."
        />
      }
      suggestions={SUGGESTIONS}
      renderPart={(part, key) =>
        part.type === "text" ? (
          <MessageResponse key={key}>{part.text}</MessageResponse>
        ) : part.type.startsWith("tool-") ? (
          <AdminToolView key={key} part={part as AdminToolPart} />
        ) : null
      }
    />
  );
}

function AdminToolView({ part }: { part: AdminToolPart }) {
  const name = part.type.slice("tool-".length);
  const bash =
    part.type === "tool-bash" && part.state === "output-available" ? part.output : null;
  // A non-zero exit is a failed command even though the tool call itself worked.
  const state = bash && bash.exitCode !== 0 ? "output-error" : part.state;

  return (
    <Tool defaultOpen={part.type === "tool-bash"} className="mb-0 w-full">
      <ToolHeader type={part.type} state={state} title={TITLES[name] ?? name} />
      <ToolContent>
        {part.type === "tool-bash" && part.input ? (
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Command</h4>
            <CodeBlock code={part.input.command ?? ""} language="bash" />
          </div>
        ) : (
          <ToolInput input={part.input} />
        )}
        {bash ? (
          <ToolOutput
            errorText={bash.exitCode !== 0 ? `Exited with code ${bash.exitCode}` : undefined}
            output={
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs">
                {bash.stdout || (bash.stderr ? "" : "(no output)")}
                {bash.stderr && <span className="text-destructive">{bash.stderr}</span>}
              </pre>
            }
          />
        ) : (
          <ToolOutput output={part.state === "output-available" ? part.output : undefined} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}
