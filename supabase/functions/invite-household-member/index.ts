import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const origin = request.headers.get("origin");
  const allowedOrigin = Deno.env.get("APP_ORIGIN");
  if (!allowedOrigin || origin !== allowedOrigin) return json(403, { error: "Origin is not allowed" });
  const redirectTarget = Deno.env.get("APP_URL") ?? `${allowedOrigin}/`;
  try {
    if (new URL(redirectTarget).origin !== allowedOrigin) return json(503, { error: "Invitation redirect is not configured" });
  } catch {
    return json(503, { error: "Invitation redirect is not configured" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return json(503, { error: "Invitation service is not configured" });
  const bearer = request.headers.get("Authorization");
  if (!bearer?.startsWith("Bearer ")) return json(401, { error: "Authentication required" });

  try {
    const { email, household_id: householdId } = await request.json();
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: "A valid email address is required" });
    }
    if (typeof householdId !== "string" || !/^[0-9a-f-]{36}$/i.test(householdId)) {
      return json(400, { error: "A valid household is required" });
    }
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: bearer } } });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json(401, { error: "Authentication required" });

    const { data: membership, error: membershipError } = await admin.from("household_members")
      .select("role").eq("household_id", householdId).eq("user_id", caller.id).maybeSingle();
    if (membershipError || membership?.role !== "admin") return json(403, { error: "Only a household administrator can invite members" });
    if (email.trim().toLocaleLowerCase() === caller.email?.toLocaleLowerCase()) return json(400, { error: "You are already a household member" });

    const { data: existingUserId, error: lookupError } = await admin.rpc("lookup_auth_user_id_by_email", { target_email: email.trim() });
    if (lookupError) return json(500, { error: "Could not validate the invitee" });
    if (existingUserId) {
      const { data: existingMembership, error: existingMembershipError } = await admin.from("household_members")
        .select("household_id").eq("user_id", existingUserId).maybeSingle();
      if (existingMembershipError) return json(500, { error: "Could not verify the invitee's household membership" });
      if (existingMembership) {
        const message = existingMembership.household_id === householdId
          ? "This user is already a household member"
          : "This user already belongs to another household";
        return json(409, { error: message });
      }
    }

    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim(), { redirectTo: redirectTarget });
    if (inviteError || !invite.user) return json(400, { error: "Invitation could not be sent; verify the email provider and invitation settings" });

    const { error: insertError } = await admin.from("household_members").upsert({
      household_id: householdId, user_id: invite.user.id, role: "member",
    }, { onConflict: "household_id,user_id", ignoreDuplicates: true });
    if (insertError) return json(500, { error: "Invitation was sent but membership setup failed; retry after checking the household members" });
    return json(200, { invited: true });
  } catch {
    return json(400, { error: "Invalid invitation request" });
  }
});
