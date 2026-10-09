import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import type { ReactNode } from "react";
import { Alert, Button, Card, buttonClass } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite, switchAccountForInvite } from "../actions";
import { INVITE_ERROR_CODES, INVITE_ERROR_TEXT, type InviteErrorCode } from "../errors";

export const metadata: Metadata = { title: "Join team" };

type InvitePreview = {
  workspace_name: string;
  email: string;
  role: string;
  status: "valid" | "expired" | "accepted";
  already_member: boolean;
};

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo height={30} />
      </div>
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <div className="mt-3 space-y-4 text-sm text-slate-600">{children}</div>
      </Card>
    </div>
  );
}

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const errorCode = INVITE_ERROR_CODES.find((c) => c === error) ?? (error ? "unknown" : null);

  // Public page: works signed in or out. The token itself authorizes the preview.
  const supabase = await createClient();
  const [user, { data }] = await Promise.all([getUser(), supabase.rpc("get_invite", { p_token: token })]);
  const invite = (data as InvitePreview[] | null)?.[0];

  if (!invite) {
    return (
      <Shell title="Invite not found">
        <p>{INVITE_ERROR_TEXT.invite_not_found}</p>
      </Shell>
    );
  }

  const team = <span className="font-medium text-slate-900">{invite.workspace_name}</span>;
  const invitedEmail = <span className="font-medium text-slate-900">{invite.email}</span>;
  const goToTeam = (
    <form action={acceptInvite}>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" className="w-full">
        Open {invite.workspace_name}
      </Button>
    </form>
  );

  const isInvitee = Boolean(user?.email && user.email.toLowerCase() === invite.email.toLowerCase());

  // Only for the invited person. The owner opening their own link must not see "you're on the team".
  if (isInvitee && invite.already_member) {
    return (
      <Shell title="You're on the team">
        <p>You are already a member of {team}.</p>
        {goToTeam}
      </Shell>
    );
  }
  if (invite.status === "accepted") {
    return (
      <Shell title="Invite already used">
        <p>{INVITE_ERROR_TEXT.invite_used} If you joined with another account, sign in with that account.</p>
        {!user ? (
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className={buttonClass("secondary", "w-full")}>
            Sign in
          </Link>
        ) : null}
      </Shell>
    );
  }
  if (invite.status === "expired") {
    return (
      <Shell title="Invite expired">
        <p>{INVITE_ERROR_TEXT.invite_expired}</p>
      </Shell>
    );
  }

  const intro = (
    <p>
      You&apos;ve been invited to join {team} as <span className="capitalize">{invite.role}</span>.
    </p>
  );
  const errorAlert =
    errorCode && errorCode !== "email_mismatch" ? (
      <Alert tone="error">{INVITE_ERROR_TEXT[errorCode as InviteErrorCode | "unknown"]}</Alert>
    ) : null;

  // Signed out: send them to create an account or sign in, keeping the invite.
  if (!user) {
    const qs = new URLSearchParams({ next: `/invite/${token}`, email: invite.email }).toString();
    return (
      <Shell title="Join your team">
        {intro}
        <p>The invite is for {invitedEmail}.</p>
        {errorAlert}
        <Link href={`/signup?${qs}`} className={buttonClass("primary", "w-full")}>
          Create account
        </Link>
        <Link href={`/login?${qs}`} className={buttonClass("secondary", "w-full")}>
          I already have an account
        </Link>
      </Shell>
    );
  }

  // Signed in as someone else (e.g. the owner testing their own link).
  if (!isInvitee) {
    return (
      <Shell title="Wrong account">
        <p>
          This is an invite to join {team} as <span className="capitalize">{invite.role}</span>.
        </p>
        <p>
          This invite is for {invitedEmail}, but you&apos;re signed in as{" "}
          <span className="font-medium text-slate-900">{user.email}</span>.
        </p>
        <form action={switchAccountForInvite}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="email" value={invite.email} />
          <Button type="submit" className="w-full">
            Sign out and continue as {invite.email}
          </Button>
        </form>
        <p className="text-xs text-slate-500">
          {invite.already_member
            ? `You're already in this team. This link is for ${invite.email} - send it to them, or open it in a private window to test it.`
            : `Sharing this link? Send it to ${invite.email}, or open it in a private window.`}
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Join your team">
      {intro}
      {errorAlert}
      <form action={acceptInvite}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" className="w-full">
          Accept and join {invite.workspace_name}
        </Button>
      </form>
    </Shell>
  );
}
