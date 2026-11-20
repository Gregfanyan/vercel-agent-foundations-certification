/**
 * Agent tools. Every store/sandbox call runs inside a `"use step"` function so
 * the workflow retries it on failure and never re-runs it once it succeeded.
 *
 * Error policy (shared by every step through `storeCall`):
 * - 4xx from the store API (bad input, missing record) → `FatalError`, no
 *   retry; the agent sees the API message and must report it honestly.
 * - 429 → retried after a pause.
 * - anything else (network, 5xx) → retried; after the last attempt the agent
 *   gets a generic "unavailable" message (never URLs, tokens or stack traces).
 */
import { tool, type InferUITools } from "ai";
import { z } from "zod";
import { FatalError, RetryableError } from "workflow";
import { start } from "workflow/api";
import { Sandbox } from "@vercel/sandbox";
import {
  ApiRequestError,
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getCategories,
  getOrder,
  getProductById,
  getProductStock,
  getProducts,
} from "./api";
import type { Product } from "./types";
import { returnFlow } from "./workflows/return-flow";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Must be a plain ID (letters, digits, _ or -)");

const date = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/,
    "Use YYYY-MM-DD or an ISO 8601 datetime",
  );

export async function storeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ApiRequestError) {
      if (err.status === 429) {
        throw new RetryableError("The store API is rate limiting requests.", {
          retryAfter: "5s",
        });
      }
      if (err.status >= 400 && err.status < 500) {
        throw new FatalError(err.message);
      }
    }
    console.error("[storeCall]", err);
    throw new Error("The store service is temporarily unavailable.");
  }
}

/** Just what a product card needs — keeps tool results (and tokens) small. */
function toCard(p: Product) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    currency: p.currency,
    category: p.category,
    images: p.images.slice(0, 1),
  };
}

// ---------------------------------------------------------------------------
// Catalog steps (shared by both agents)
// ---------------------------------------------------------------------------

async function searchProductsStep(input: {
  query?: string;
  category?: string;
  page?: number;
  limit?: number;
}) {
  "use step";
  const products = await storeCall(() =>
    getProducts({
      search: input.query,
      category: input.category,
      page: input.page,
      limit: input.limit ?? 12,
    }),
  );
  return { count: products.length, products: products.map(toCard) };
}

async function getAllCategoriesStep() {
  "use step";
  const categories = await storeCall(() => getCategories());
  return { categories };
}

async function getProductDetailsStep({ productId }: { productId: string }) {
  "use step";
  const [product, stock] = await Promise.all([
    storeCall(() => getProductById(productId)),
    // Stock is best-effort: a stock outage shouldn't hide the product.
    getProductStock(productId).catch(() => null),
  ]);
  return { product, stock };
}

const searchProducts = tool({
  description:
    "Search the store catalog by text and/or category. Call with no query and no category to browse the full catalog. Results are shown to the shopper as product cards.",
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Free-text search, e.g. 'water bottle'"),
    category: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,40}$/)
      .optional()
      .describe("Category slug from getAllCategories, e.g. 'hoodies'"),
    page: z.number().int().min(1).max(50).optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Default 12"),
  }),
  // Wrapped so only the input (not the whole chat) becomes step arguments.
  execute: (input) => searchProductsStep(input),
});

const getAllCategories = tool({
  description:
    "List every product category in the store with its slug and product count.",
  inputSchema: z.object({}),
  execute: () => getAllCategoriesStep(),
});

const getProductDetails = tool({
  description:
    "Get one product's full details (description, price, images, tags) plus live stock. Shown to the shopper as a product detail card.",
  inputSchema: z.object({
    productId: id.describe("Product id or slug, e.g. 'hoodie_001'"),
  }),
  execute: (input) => getProductDetailsStep(input),
});

// ---------------------------------------------------------------------------
// Returns (shopping agent only)
// ---------------------------------------------------------------------------

async function checkReturnableOrder(orderId: string) {
  "use step";
  const order = await storeCall(() => getOrder(orderId));
  return {
    id: order.id,
    status: order.status,
    total: order.total,
    currency: order.currency,
    items: order.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    })),
  };
}

const returnOrder = tool({
  description:
    "File a return for a fulfilled order. Requires the order ID and the shopper's reason. Looks up the order, then starts the return process (customer notification, refund pre-authorization, return filing) in the background.",
  inputSchema: z.object({
    orderId: id.describe("The order ID the shopper gave, e.g. '11111'"),
    reason: z.string().trim().min(3).max(500).describe("Why it's being returned"),
  }),
  // Runs in workflow context: the lookup is a step, and `start()` is
  // step-backed, so a replay never files the same return twice.
  execute: async ({ orderId, reason }) => {
    const order = await checkReturnableOrder(orderId);
    if (order.status !== "fulfilled") {
      return {
        filed: false as const,
        orderId,
        orderStatus: order.status,
        message: `Order ${orderId} is "${order.status}". Only fulfilled orders can be returned.`,
      };
    }
    await start(returnFlow, [
      { orderId, reason, items: order.items },
    ]);
    return {
      filed: true as const,
      orderId,
      items: order.items,
      total: order.total,
      currency: order.currency,
      message:
        "Return filed. The customer will be notified, the refund pre-authorized and the return submitted; the decision arrives by email.",
    };
  },
});

export const shopTools = {
  searchProducts,
  getAllCategories,
  getProductDetails,
  returnOrder,
};
export type ShopUITools = InferUITools<typeof shopTools>;

// ---------------------------------------------------------------------------
// Admin sandbox: one persistent, network-isolated VM shared by every admin
// conversation. Holds the memory file and per-conversation data files.
// ---------------------------------------------------------------------------

const SANDBOX_NAME = "ship-shop-admin";
const ROOT = "/vercel/sandbox";
export const MEMORY_PATH = `${ROOT}/memory.md`;
const MAX_OUTPUT = 8_000;
const PREVIEW_ROWS = 50;

function getAdminSandbox() {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    persistent: true,
    snapshotExpiration: 0,
    timeout: 10 * 60_000,
    // No network: model-written commands can't exfiltrate data, and no
    // store credentials ever enter the VM.
    networkPolicy: "deny-all",
  });
}

const chatDir = (chatId: string) => `${ROOT}/chats/${chatId}`;
const clip = (s: string) =>
  s.length > MAX_OUTPUT
    ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated ${s.length - MAX_OUTPUT} chars]`
    : s;

export async function loadMemory() {
  "use step";
  try {
    const sandbox = await getAdminSandbox();
    const buf = await sandbox.readFileToBuffer({ path: MEMORY_PATH });
    return { available: true, memory: buf?.toString("utf8").trim() || null };
  } catch (err) {
    console.error("[loadMemory]", err);
    return { available: false, memory: null };
  }
}

async function saveMemoryStep(input: { note: string; kind: string }) {
  "use step";
  const sandbox = await getAdminSandbox();
  const existing =
    (await sandbox.readFileToBuffer({ path: MEMORY_PATH }))?.toString("utf8") ??
    "# Store admin memory\n";
  const line = `- [${new Date().toISOString().slice(0, 10)}] (${input.kind}) ${input.note.replace(/\s+/g, " ")}\n`;
  // ponytail: read-append-write, concurrent saves can drop a line; use a lock file if admins multiply.
  await sandbox.writeFiles([
    { path: MEMORY_PATH, content: existing.endsWith("\n") ? existing + line : `${existing}\n${line}` },
  ]);
  return { saved: true, note: line.trim() };
}

async function runBashStep(chatId: string, command: string) {
  "use step";
  const sandbox = await getAdminSandbox();
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", `mkdir -p "$WORKDIR" && cd "$WORKDIR" && ${command}`],
    env: { WORKDIR: chatDir(chatId) },
    timeoutMs: 60_000,
  });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  return { exitCode: result.exitCode, stdout: clip(stdout), stderr: clip(stderr) };
}

/** Save the full rows where `bash` can join/aggregate them; best-effort. */
async function saveDataset(chatId: string, name: string, rows: unknown) {
  try {
    const sandbox = await getAdminSandbox();
    const path = `${chatDir(chatId)}/${name}-${Date.now()}.json`;
    await sandbox.writeFiles([{ path, content: JSON.stringify(rows) }]);
    return path;
  } catch (err) {
    console.error("[saveDataset]", err);
    return null;
  }
}

type BackOfficeQuery =
  | { kind: "support-tickets"; params: Parameters<typeof getBackOfficeSupportTickets>[0] }
  | { kind: "returns"; params: Parameters<typeof getBackOfficeReturns>[0] }
  | { kind: "stock"; params: Parameters<typeof getBackOfficeStock>[0] }
  | { kind: "sales"; params: Parameters<typeof getBackOfficeSales>[0] };

async function backOfficeStep(chatId: string, q: BackOfficeQuery) {
  "use step";
  const { data, meta } = await storeCall<{ data: unknown[]; meta: unknown }>(() => {
    switch (q.kind) {
      case "support-tickets":
        return getBackOfficeSupportTickets(q.params);
      case "returns":
        return getBackOfficeReturns(q.params);
      case "stock":
        return getBackOfficeStock(q.params);
      case "sales":
        return getBackOfficeSales(q.params);
    }
  });
  const file = data.length ? await saveDataset(chatId, q.kind, data) : null;
  return {
    meta,
    rowCount: data.length,
    rows: data.slice(0, PREVIEW_ROWS),
    truncated: data.length > PREVIEW_ROWS,
    file,
  };
}

/** Admin tools are per-conversation so data files land in that chat's dir. */
export function createAdminTools(chatId: string) {
  return {
    searchProducts,
    getAllCategories,

    getSupportTickets: tool({
      description:
        "Read support tickets. Defaults to the last 30 days and 25 rows. Read-only.",
      inputSchema: z.object({
        from: date.optional(),
        to: date.optional(),
        status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        category: z
          .enum(["shipping", "returns", "product_quality", "sizing", "billing", "payment", "account", "other"])
          .optional(),
        assignee: z.string().trim().regex(/^[a-z0-9_.-]{1,40}$/i).optional().describe("Staff username, e.g. 'alex'"),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: (params) => backOfficeStep(chatId, { kind: "support-tickets", params }),
    }),

    getReturnsHistory: tool({
      description:
        "Read return requests with order and refund info. Defaults to the last 30 days and 25 rows. Read-only.",
      inputSchema: z.object({
        from: date.optional(),
        to: date.optional(),
        status: z.enum(["pending", "processing", "completed"]).optional(),
        decision: z.enum(["approved", "rejected", "needs_info"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: (params) => backOfficeStep(chatId, { kind: "returns", params }),
    }),

    getInventoryStock: tool({
      description:
        "Read inventory levels. lowStock=true means 1–5 units. Paginated (default 50 per page, max 200); check meta.pagination. Read-only.",
      inputSchema: z.object({
        productIds: z.array(id).min(1).max(100).optional(),
        lowStock: z.boolean().optional(),
        inStock: z.boolean().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: (params) => backOfficeStep(chatId, { kind: "stock", params }),
    }),

    getSalesAnalytics: tool({
      description:
        "Per-product sales (units, orders, revenue in cents) for a date range, with totals in meta. Defaults to the last 30 days. Read-only.",
      inputSchema: z.object({
        from: date.optional(),
        to: date.optional(),
        productId: id.optional(),
      }),
      execute: (params) => backOfficeStep(chatId, { kind: "sales", params }),
    }),

    bash: tool({
      description:
        "Run a bash command in the admin's isolated sandbox (no network; python3, node, jq-style tooling). The working directory holds the JSON files saved by the data tools in this conversation; use it for aggregates and joins. Output is truncated to 8k chars.",
      inputSchema: z.object({
        command: z.string().min(1).max(4_000),
      }),
      execute: ({ command }) => runBashStep(chatId, command),
    }),

    saveMemory: tool({
      description:
        "Append one durable note to the admin memory file: a stated preference, a correction of your earlier answer, or business context. Never store raw store data, secrets or passwords.",
      inputSchema: z.object({
        kind: z.enum(["preference", "correction", "business-context"]),
        note: z.string().trim().min(3).max(500),
      }),
      execute: (input) => saveMemoryStep(input),
    }),
  };
}
export type AdminUITools = InferUITools<ReturnType<typeof createAdminTools>>;
