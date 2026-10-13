import { createClient } from "npm:@supabase/supabase-js@2";

function json(status: number, body: Record<string, unknown>, origin: string | null) {
  const allowedOrigin = Deno.env.get("APP_ORIGIN") ?? "";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin === allowedOrigin ? allowedOrigin : "null",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json",
    },
  });
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `ML-${hex.toUpperCase()}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return json(200, {}, origin);
  if (request.method !== "POST") return json(405, { error: "Method not allowed" }, origin);
  const allowedOrigin = Deno.env.get("APP_ORIGIN");
  if (!allowedOrigin || origin !== allowedOrigin) return json(403, { error: "Origin is not allowed" }, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return json(503, { error: "Invite service is not configured" }, origin);

  const bearer = request.headers.get("Authorization");
  if (!bearer?.startsWith("Bearer ")) return json(401, { error: "Authentication required" }, origin);
  try {
    const body = await request.json();
    const householdId = body?.household_id;
    const label = body?.label;
    const validDays = body?.valid_days ?? 7;
    if (typeof householdId !== "string" || !/^[0-9a-f-]{36}$/i.test(householdId)) {
      return json(400, { error: "A valid household is required" }, origin);
    }
    if (typeof label !== "string" || label.trim().length < 1 || label.trim().length > 80) {
      return json(400, { error: "Invite name must be between 1 and 80 characters" }, origin);
    }
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 30) {
      return json(400, { error: "Invite expiry must be between 1 and 30 days" }, origin);
    }

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: bearer } } });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json(401, { error: "Authentication required" }, origin);

    const code = randomCode();
    const tokenHash = await sha256Hex(code);
    const { data: invite, error: insertError } = await admin.rpc("create_household_invite", {
      target_household_id: householdId,
      target_creator_id: caller.id,
      invite_label: label.trim(),
      token_hash_hex: tokenHash,
      valid_days: validDays,
    });
    if (insertError || !invite) {
      return json(403, { error: "Only a household administrator can create invite codes" }, origin);
    }

    return json(200, {
      invite_id: invite.invite_id,
      code,
      label: label.trim(),
      expires_at: invite.expires_at,
      household_id: householdId,
    }, origin);
  } catch {
    return json(400, { error: "Invalid invite request" }, origin);
  }
});
