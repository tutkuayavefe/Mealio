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
    const rawCode = body?.code;
    if (typeof rawCode !== "string" || rawCode.length > 80) return json(400, { error: "A valid invite code is required" }, origin);
    const code = rawCode.trim().toUpperCase();
    if (!/^ML-[0-9A-F]{64}$/.test(code)) return json(400, { error: "A valid invite code is required" }, origin);

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: bearer } } });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json(401, { error: "Authentication required" }, origin);

    const tokenHash = await sha256Hex(code);
    const { data: household, error: redeemError } = await admin.rpc("redeem_household_invite", {
      token_hash_hex: tokenHash,
      target_user_id: caller.id,
    });
    if (redeemError || !household?.household_id) {
      const alreadyJoined = redeemError?.message?.includes("another household");
      return json(alreadyJoined ? 409 : 400, {
        error: alreadyJoined ? "Your account already belongs to another household" : "Invite code is invalid, expired, or already used",
      }, origin);
    }
    return json(200, {
      household_id: household.household_id,
      household_name: household.household_name,
    }, origin);
  } catch {
    return json(400, { error: "Invalid invite request" }, origin);
  }
});
