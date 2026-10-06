import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const WORKSPACE_COOKIE = "lg_ws";

export type MemberRole = "owner" | "staff";

export type WorkspaceContext = {
  id: string;
  name: string;
  vertical: string;
  timezone: string;
  role: MemberRole;
  setupCompletedAt: string | null;
};

/** The signed-in user (verified with Supabase Auth), or null. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_platform_admin")
    .eq("id", user.id)
    .single();
  return data;
});

/** All workspaces the user belongs to. RLS limits rows to the user's memberships. */
export const listWorkspaces = cache(async (): Promise<WorkspaceContext[]> => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces (id, name, vertical, timezone, setup_completed_at)")
    .eq("user_id", user.id)
    .order("created_at");
  if (error) throw error;

  return (data ?? []).flatMap((row) => {
    const ws = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
    if (!ws) return [];
    return [
      {
        id: ws.id,
        name: ws.name,
        vertical: ws.vertical,
        timezone: ws.timezone,
        role: row.role as MemberRole,
        setupCompletedAt: ws.setup_completed_at,
      },
    ];
  });
});

/**
 * The workspace the user is currently working in: the one in the cookie if the
 * user is still a member, otherwise their first workspace. Null if they have none.
 */
export const getCurrentWorkspace = cache(async (): Promise<WorkspaceContext | null> => {
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) return null;
  const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return workspaces.find((w) => w.id === selected) ?? workspaces[0];
});

/** Remember which workspace the user is working in (server actions / route handlers only). */
export async function selectWorkspace(workspaceId: string) {
  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/** Use in app pages: guarantees a signed-in user with a workspace. */
export async function requireWorkspace() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  return workspace;
}

export async function requireOwner() {
  const workspace = await requireWorkspace();
  if (workspace.role !== "owner") redirect("/dashboard");
  return workspace;
}
