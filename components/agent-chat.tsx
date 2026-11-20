"use client";

import type { UIMessage } from "ai";
import { AlertCircle, Bot, CheckCircle2, PackageX } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { ChatShell } from "@/components/chat-shell";
import { ProductCard } from "@/components/product-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useDurableChat, useIsClient } from "@/hooks/use-durable-chat";
import { formatPrice } from "@/lib/format";
import type { ShopUITools } from "@/lib/tools";

type ShopMessage = UIMessage<unknown, never, ShopUITools>;
type ShopPart = ShopMessage["parts"][number];
type ToolPartOf<T extends ShopPart["type"]> = Extract<ShopPart, { type: T }>;

export function AgentChat() {
  // localStorage-backed: render only after mount to avoid hydration mismatch.
  return useIsClient() ? <ShopChat /> : null;
}

function ShopChat() {
  const chat = useDurableChat<ShopMessage>("/api/chat", "ship-it-shop:chat");
  return (
    <ChatShell
      chat={chat}
      label="Shopping assistant conversation"
      placeholder="Ask about products or returns…"
      empty={
        <ConversationEmptyState
          icon={<Bot className="size-8" aria-hidden="true" />}
          title="Hi! I'm the Ship It Shop assistant"
          description="I can find products, show details and stock, and file returns for fulfilled orders."
        />
      }
      suggestions={["What categories do you sell?", "Show me hoodies", "I want to return an order"]}
      renderPart={(part, key) => <ShopPartView key={key} part={part} />}
    />
  );
}

function ShopPartView({ part }: { part: ShopPart }) {
  switch (part.type) {
    case "text":
      return <MessageResponse>{part.text}</MessageResponse>;
    case "tool-searchProducts":
      return <SearchResults part={part} />;
    case "tool-getProductDetails":
      return <ProductDetails part={part} />;
    case "tool-getAllCategories":
      return <Categories part={part} />;
    case "tool-returnOrder":
      return <ReturnStatus part={part} />;
    default:
      return null;
  }
}

/** Loading → error → result, shared by every tool view. */
function ToolState<P extends { state: string; output?: unknown; errorText?: string }>({
  part,
  loading,
  children,
}: {
  part: P;
  loading: ReactNode;
  children: (output: NonNullable<P["output"]>) => ReactNode;
}) {
  if (part.state === "output-error") {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        {part.errorText || "Something went wrong."}
      </p>
    );
  }
  if (part.state !== "output-available" || part.output == null) {
    return <div role="status">{loading}</div>;
  }
  return <>{children(part.output as NonNullable<P["output"]>)}</>;
}

const Pending = ({ children }: { children: ReactNode }) => (
  <p className="flex items-center gap-2 text-sm text-muted-foreground">
    <Spinner /> {children}
  </p>
);

function SearchResults({ part }: { part: ToolPartOf<"tool-searchProducts"> }) {
  return (
    <ToolState
      part={part}
      loading={
        <div className="grid grid-cols-2 gap-3" aria-label="Searching products">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-lg" />
          ))}
        </div>
      }
    >
      {({ products }) =>
        products.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
            <PackageX className="size-4" aria-hidden="true" /> No products matched that search.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3" aria-label={`${products.length} products`}>
            {products.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        )
      }
    </ToolState>
  );
}

function StockLabel({ stock }: { stock: { stock: number; inStock: boolean; lowStock: boolean } | null }) {
  if (!stock) return <Badge variant="outline">Stock unavailable right now</Badge>;
  if (!stock.inStock) return <Badge variant="destructive">Out of stock</Badge>;
  if (stock.lowStock) return <Badge variant="secondary">Only {stock.stock} left</Badge>;
  return <Badge variant="secondary">In stock ({stock.stock})</Badge>;
}

function ProductDetails({ part }: { part: ToolPartOf<"tool-getProductDetails"> }) {
  return (
    <ToolState part={part} loading={<Skeleton className="h-64 rounded-lg" aria-label="Loading product details" />}>
      {({ product, stock }) => (
        <article className="overflow-hidden rounded-lg border bg-card">
          {product.images.length > 0 && (
            <div className="grid grid-cols-3 gap-1 bg-secondary p-1">
              {product.images.slice(0, 6).map((src, i) => (
                <div key={src} className={`relative aspect-square overflow-hidden rounded ${i === 0 ? "col-span-3" : ""}`}>
                  <Image
                    src={src}
                    alt={i === 0 ? product.name : `${product.name}, view ${i + 1}`}
                    fill
                    sizes="(min-width: 640px) 28rem, 100vw"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{product.name}</h3>
              <p className="font-medium">{formatPrice(product.price, product.currency)}</p>
            </div>
            <StockLabel stock={stock} />
            <p className="text-sm text-muted-foreground">{product.description}</p>
            {product.tags.length > 0 && (
              <ul className="flex flex-wrap gap-1" aria-label="Tags">
                {product.tags.map((t) => (
                  <li key={t}>
                    <Badge variant="outline">{t}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/products/${product.id}`} className="inline-block text-sm font-medium underline underline-offset-4">
              View product page
            </Link>
          </div>
        </article>
      )}
    </ToolState>
  );
}

function Categories({ part }: { part: ToolPartOf<"tool-getAllCategories"> }) {
  return (
    <ToolState part={part} loading={<Pending>Loading categories…</Pending>}>
      {({ categories }) =>
        categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories found.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Categories">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/search?category=${encodeURIComponent(c.slug)}`}
                  className="inline-flex rounded-full border px-3 py-1 text-xs hover:bg-accent"
                >
                  {c.name} ({c.productCount})
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    </ToolState>
  );
}

function ReturnStatus({ part }: { part: ToolPartOf<"tool-returnOrder"> }) {
  return (
    <ToolState part={part} loading={<Pending>Checking your order…</Pending>}>
      {(result) =>
        result.filed ? (
          <div className="flex items-start gap-2 rounded-lg border border-green-600/30 bg-green-600/5 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden="true" />
            <div>
              <p className="font-medium">Return filed for order {result.orderId}</p>
              <p className="text-muted-foreground">
                {result.items.reduce((n, i) => n + i.quantity, 0)} item(s),{" "}
                {formatPrice(result.total, result.currency)}. We'll email you the decision.
              </p>
            </div>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border p-3 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            {result.message}
          </p>
        )
      }
    </ToolState>
  );
}
