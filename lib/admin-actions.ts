"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./admin-auth";

const COOKIE_MAX_AGE = 60 * 60 * 24; // 1 day

export async function loginAction(formData: FormData): Promise<void> {
  const password = formData.get("password");
  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    redirect("/admin/login?error=1");
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, ADMIN_PASSWORD, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    // "/" so the cookie also reaches the admin agent API under /api/admin.
    path: "/",
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE_NAME);
  // Clear the old /admin-scoped cookie too for users who logged in before the
  // chat API moved outside that path.
  store.set(ADMIN_COOKIE_NAME, "", { path: "/admin", maxAge: 0 });
  redirect("/admin/login");
}
