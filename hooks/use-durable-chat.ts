"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/** False during SSR/hydration, true after mount (lets us read localStorage safely). */
export function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

interface Saved<M> {
  id: string;
  messages: M[];
  /** Workflow run of an unfinished turn; present only while one is streaming. */
  runId?: string;
}

function load<M extends UIMessage>(key: string): Saved<M> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Saved<M> | null;
    if (saved && typeof saved.id === "string" && Array.isArray(saved.messages)) {
      if (saved.runId) {
        // The reconnect replays the whole reply, so drop any partial copy of it.
        const lastUser = saved.messages.findLastIndex((m) => m.role === "user");
        saved.messages = saved.messages.slice(0, lastUser + 1);
      }
      return saved;
    }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  return { id: crypto.randomUUID(), messages: [] };
}

/**
 * useChat on top of a durable workflow run. The conversation lives in
 * localStorage under `storageKey`; if the page reloads (or the connection
 * drops) mid-answer, it reconnects to `{api}/{runId}/stream` and replays the
 * run's stream instead of starting the turn again.
 * Mount only on the client (see useIsClient).
 */
export function useDurableChat<M extends UIMessage>(api: string, storageKey: string) {
  const [saved, setSaved] = useState(() => load<M>(storageKey));
  const runId = useRef(saved.runId);
  const persist = (messages: M[]) => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ id: saved.id, messages, runId: runId.current }),
      );
    } catch {
      // Quota/private mode: the chat still works, it just won't survive a reload.
    }
  };

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<M>({
        api,
        maxConsecutiveErrors: 5,
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, messages },
        }),
        prepareReconnectToStreamRequest: ({ api: fallback }) => ({
          // `fallback` already contains the workflow run ID during normal
          // reconnects. `runId` is only needed after a page reload.
          api: runId.current
            ? `${api}/${encodeURIComponent(runId.current)}/stream`
            : fallback,
        }),
        onChatSendMessage: (response, { messages }) => {
          runId.current = response.headers.get("x-workflow-run-id") ?? undefined;
          persist(messages);
        },
        onChatEnd: () => {
          runId.current = undefined;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, saved.id],
  );

  const chat = useChat<M>({
    id: saved.id,
    messages: saved.messages,
    transport,
    resume: Boolean(saved.runId),
  });

  useEffect(() => {
    if (chat.status === "error") runId.current = undefined;
    if (chat.status === "ready" || chat.status === "error") persist(chat.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, chat.messages]);

  // Save the user message and active workflow ID immediately, before a reload
  // can interrupt the streamed assistant response.
  useEffect(() => {
    if (chat.status === "submitted" || chat.status === "streaming") {
      persist(chat.messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.status, chat.messages]);

  const reset = () => {
    chat.stop();
    runId.current = undefined;
    localStorage.removeItem(storageKey);
    setSaved({ id: crypto.randomUUID(), messages: [] });
  };

  return { ...chat, reset };
}
