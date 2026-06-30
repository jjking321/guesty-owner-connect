import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Not authenticated" });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json(401, { error: "Invalid token" });

    const body = await req.json().catch(() => ({}));
    const { account_id, account_name, api_base_url, username, password } = body ?? {};

    if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
      return json(400, { error: "username and password are required" });
    }

    // Update existing account credentials
    if (account_id) {
      const { data: existing, error: existingError } = await admin
        .from("track_accounts")
        .select("id, organization_id")
        .eq("id", account_id)
        .single();
      if (existingError || !existing) return json(404, { error: "Account not found" });

      const [{ data: isAdmin }, { data: isSuperAdmin }] = await Promise.all([
        admin.rpc("has_organization_role", {
          _organization_id: existing.organization_id,
          _user_id: user.id,
          _role: "admin",
        }),
        admin.rpc("has_organization_role", {
          _organization_id: existing.organization_id,
          _user_id: user.id,
          _role: "super_admin",
        }),
      ]);
      if (!isAdmin && !isSuperAdmin) return json(403, { error: "Insufficient permissions" });

      const { error: upsertError } = await admin
        .from("track_account_credentials")
        .upsert(
          {
            track_account_id: account_id,
            username,
            password,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "track_account_id" },
        );
      if (upsertError) throw upsertError;

      return json(200, { success: true, account_id });
    }

    // New account
    if (typeof account_name !== "string" || !account_name) {
      return json(400, { error: "account_name is required for new accounts" });
    }
    if (typeof api_base_url !== "string" || !/^https:\/\//i.test(api_base_url)) {
      return json(400, { error: "api_base_url must be a valid https URL" });
    }

    const { data: membership, error: memberError } = await admin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .single();
    if (memberError || !membership) return json(403, { error: "No organization membership found" });
    if (membership.role !== "admin" && membership.role !== "super_admin") {
      return json(403, { error: "Only admins can connect TrackHS accounts" });
    }

    const { data: newAccount, error: insertError } = await admin
      .from("track_accounts")
      .insert({
        organization_id: membership.organization_id,
        account_name,
        api_base_url: api_base_url.replace(/\/+$/, ""),
      })
      .select("id")
      .single();
    if (insertError || !newAccount) throw insertError ?? new Error("Insert failed");

    const { error: credError } = await admin
      .from("track_account_credentials")
      .insert({
        track_account_id: newAccount.id,
        username,
        password,
      });
    if (credError) {
      await admin.from("track_accounts").delete().eq("id", newAccount.id);
      throw credError;
    }

    return json(200, { success: true, account_id: newAccount.id });
  } catch (error: any) {
    console.error("save-track-credentials error:", error);
    return json(500, { error: error?.message ?? "Unknown error" });
  }
});
