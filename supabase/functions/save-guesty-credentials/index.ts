import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Validate JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { account_name, client_id, client_secret, account_id } = body;

    if (typeof client_id !== 'string' || client_id.length === 0 ||
        typeof client_secret !== 'string' || client_secret.length === 0) {
      return new Response(JSON.stringify({ error: 'client_id and client_secret are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update path: editing credentials for an existing account
    if (account_id) {
      // Look up the account to get its organization_id
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('guesty_accounts')
        .select('id, organization_id')
        .eq('id', account_id)
        .single();

      if (existingError || !existing) {
        return new Response(JSON.stringify({ error: 'Account not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Verify caller is admin/super_admin of that organization
      const { data: isAdmin } = await supabaseAdmin.rpc('has_organization_role', {
        _organization_id: existing.organization_id,
        _user_id: user.id,
        _role: 'admin',
      });
      const { data: isSuperAdmin } = await supabaseAdmin.rpc('has_organization_role', {
        _organization_id: existing.organization_id,
        _user_id: user.id,
        _role: 'super_admin',
      });

      if (!isAdmin && !isSuperAdmin) {
        return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error: upsertError } = await supabaseAdmin
        .from('guesty_account_credentials')
        .upsert({
          guesty_account_id: account_id,
          client_id,
          client_secret,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'guesty_account_id' });

      if (upsertError) throw upsertError;

      return new Response(JSON.stringify({ success: true, account_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert path: creating a new account
    if (typeof account_name !== 'string' || account_name.length === 0) {
      return new Response(JSON.stringify({ error: 'account_name is required for new accounts' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find caller's organization
    const { data: membership, error: memberError } = await supabaseAdmin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return new Response(JSON.stringify({ error: 'No organization membership found' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (membership.role !== 'admin' && membership.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Only admins can connect Guesty accounts' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert account, then upsert credentials
    const { data: newAccount, error: insertError } = await supabaseAdmin
      .from('guesty_accounts')
      .insert({
        user_id: user.id,
        organization_id: membership.organization_id,
        account_name,
      })
      .select('id')
      .single();

    if (insertError || !newAccount) throw insertError ?? new Error('Insert failed');

    const { error: credError } = await supabaseAdmin
      .from('guesty_account_credentials')
      .insert({
        guesty_account_id: newAccount.id,
        client_id,
        client_secret,
      });

    if (credError) {
      // Roll back the account row so we never have an account without credentials
      await supabaseAdmin.from('guesty_accounts').delete().eq('id', newAccount.id);
      throw credError;
    }

    return new Response(JSON.stringify({ success: true, account_id: newAccount.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('save-guesty-credentials error:', error);
    return new Response(JSON.stringify({ error: error.message ?? 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
