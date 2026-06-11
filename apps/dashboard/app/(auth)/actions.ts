"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { BASE_PATH } from "@/lib/base-path";

type FormState = { error?: string; message?: string };

// Password sign-in is now handled client-side in app/(auth)/login/page.tsx
// (signInWithPassword via the browser client, so ?next= is honoured). The
// previous server-side loginAction was unused dead code and has been removed.

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Email is required." };

  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Raw URL (not router-built), so the base path must be applied by hand.
    redirectTo: `${origin}${BASE_PATH}/reset-password`,
  });

  if (error) return { error: error.message };
  return {
    message:
      "If an account exists for that email, a reset link has been sent.",
  };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { error: error.message };
  redirect("/");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
