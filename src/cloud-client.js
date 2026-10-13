import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./cloud-config.js";

let clientPromise;
let householdId;
let householdUserId;

export function isCloudConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export async function getCloudClient() {
  if (!isCloudConfigured()) throw new Error("Ortak arşiv henüz yapılandırılmadı. Kurulum için README'ye bak.");
  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@supabase/supabase-js@2.57.4")
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }))
      .catch((error) => { clientPromise = undefined; throw error; });
  }
  return clientPromise;
}

export async function getSession() {
  const client = await getCloudClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function requestSignInLink(email) {
  const client = await getCloudClient();
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = await getCloudClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  householdId = undefined;
  householdUserId = undefined;
}

export async function getHouseholdId() {
  const client = await getCloudClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (householdUserId !== user.id) { householdUserId = user.id; householdId = undefined; }
  if (householdId) return householdId;
  const { data, error } = await client.from("household_members").select("household_id").eq("user_id", user.id).limit(1);
  if (error) throw error;
  householdId = data?.[0]?.household_id;
  return householdId;
}

export async function getHouseholdDetails() {
  const id = await getHouseholdId();
  if (!id) return null;
  const client = await getCloudClient();
  const { data, error } = await client.from("households").select("id,name").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createHousehold(name) {
  const client = await getCloudClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const { data, error } = await client.rpc("create_household", { household_name: name.trim() });
  if (error) throw error;
  householdId = data;
  householdUserId = user.id;
  return data;
}

export async function inviteHouseholdMember(email) {
  const client = await getCloudClient();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const { error } = await client.functions.invoke("invite-household-member", {
    body: { email: email.trim(), household_id: await getHouseholdId() },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
}

export async function currentUserEmail() {
  const client = await getCloudClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error) throw error;
  return user.email;
}

export async function setActiveHousehold(id) {
  householdId = id;
}

export async function authStateChange(callback) {
  const client = await getCloudClient();
  return client.auth.onAuthStateChange((_event, session) => {
    const nextUserId = session?.user?.id;
    if (nextUserId !== householdUserId) { householdId = undefined; householdUserId = nextUserId; }
    callback(session);
  });
}
