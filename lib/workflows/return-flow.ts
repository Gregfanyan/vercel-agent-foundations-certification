import { FatalError } from "workflow";
import {
  ApiRequestError,
  createReturn,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "@/lib/api";

export interface ReturnRequest {
  orderId: string;
  reason: string;
  items: { productId: string; quantity: number }[];
}

// Each side effect is its own step: a retry resumes at the step that failed,
// so a customer is never notified twice and a refund never authorized twice.

async function notifyCustomer(orderId: string) {
  "use step";
  await notifyReturnInProcess(orderId);
}

/** 4xx won't succeed on retry; everything else is retried by the step. */
function fatalOn4xx(err: unknown): never {
  if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500 && err.status !== 429) {
    throw new FatalError(err.message);
  }
  throw err;
}

async function authorizeRefund(orderId: string) {
  "use step";
  return preauthorizeRefund(orderId).catch(fatalOn4xx);
}

async function fileReturn(input: ReturnRequest) {
  "use step";
  return createReturn(input).catch(fatalOn4xx);
}

export async function returnFlow(input: ReturnRequest) {
  "use workflow";
  await notifyCustomer(input.orderId);
  const refund = await authorizeRefund(input.orderId);
  const filed = await fileReturn(input);
  // ponytail: decision callback (createWebhook) skipped; GET /returns/{id} has the outcome.
  return { returnId: filed.id, status: filed.status, refundAuthorizationId: refund.id };
}
