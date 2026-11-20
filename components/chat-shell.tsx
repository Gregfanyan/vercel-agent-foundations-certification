"use client";

import type { UIMessage } from "ai";
import { SquarePen } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { useDurableChat } from "@/hooks/use-durable-chat";

/** Layout shared by the shopping and admin chats; each supplies its own parts UI. */
export function ChatShell<M extends UIMessage>({
  chat,
  label,
  placeholder,
  empty,
  suggestions,
  renderPart,
}: {
  chat: ReturnType<typeof useDurableChat<M>>;
  label: string;
  placeholder: string;
  empty: ReactNode;
  suggestions?: string[];
  renderPart: (part: M["parts"][number], key: string) => ReactNode;
}) {
  const { messages, status, error, sendMessage, stop, regenerate, reset } = chat;
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text: text.trim() });
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1" aria-label={label} aria-busy={busy}>
        <ConversationContent className="gap-6">
          {messages.length === 0 && empty}
          {messages.map((m) => (
            <Message from={m.role} key={m.id}>
              <MessageContent className="w-full">
                {m.parts.map((part, i) => renderPart(part, `${m.id}-${i}`))}
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Thinking…
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <p className="flex-1">
                Sorry, something went wrong, so this answer may be missing or incomplete.
              </p>
              <Button size="sm" variant="outline" onClick={() => regenerate()}>
                Try again
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="Scroll to latest message" />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {suggestions && messages.length === 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Suggested questions" role="group">
            {suggestions.map((s) => (
              <Suggestion
                key={s}
                suggestion={s}
                onClick={send}
                className="h-auto whitespace-normal py-1.5 text-left"
              />
            ))}
          </div>
        )}
        <PromptInput onSubmit={({ text }) => send(text)}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label={placeholder}
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder={placeholder}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton onClick={reset} disabled={messages.length === 0}>
                <SquarePen aria-hidden="true" />
                <span>New conversation</span>
              </PromptInputButton>
            </PromptInputTools>
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
