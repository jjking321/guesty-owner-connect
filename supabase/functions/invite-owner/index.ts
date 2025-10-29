import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InviteOwnerRequest {
  ownerId: string;
  email: string;
  password: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the requesting user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Check if user is admin or super_admin
    const { data: member, error: memberError } = await supabaseAdmin
      .from('organization_members')
      .select('role, organization_id')
      .eq('user_id', user.id)
      .single();

    if (memberError || !member || !['super_admin', 'admin'].includes(member.role)) {
      throw new Error('Insufficient permissions');
    }

    const { ownerId, email, password }: InviteOwnerRequest = await req.json();

    if (!ownerId || !email || !password) {
      throw new Error('Missing required fields');
    }

    // Verify owner exists and belongs to the same organization
    const { data: owner, error: ownerError } = await supabaseAdmin
      .from('owners')
      .select('id, guesty_account_id')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      throw new Error('Owner not found');
    }

    // Verify owner's guesty account belongs to user's organization
    const { data: guestyAccount } = await supabaseAdmin
      .from('guesty_accounts')
      .select('organization_id')
      .eq('id', owner.guesty_account_id)
      .single();

    if (!guestyAccount || guestyAccount.organization_id !== member.organization_id) {
      throw new Error('Owner does not belong to your organization');
    }

    // Check if owner already has portal access
    const { data: existingOwnerUser } = await supabaseAdmin
      .from('owner_users')
      .select('id')
      .eq('owner_id', ownerId)
      .single();

    if (existingOwnerUser) {
      throw new Error('Owner already has portal access');
    }

    // Create user account
    const { data: newUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createUserError) {
      throw new Error(`Failed to create user: ${createUserError.message}`);
    }

    if (!newUser.user) {
      throw new Error('Failed to create user');
    }

    // Link user to owner
    const { error: ownerUserError } = await supabaseAdmin
      .from('owner_users')
      .insert({
        owner_id: ownerId,
        user_id: newUser.user.id,
        organization_id: member.organization_id,
      });

    if (ownerUserError) {
      // Rollback: delete the created user
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error(`Failed to link user to owner: ${ownerUserError.message}`);
    }

    // Add user to organization with owner role
    const { error: memberError2 } = await supabaseAdmin
      .from('organization_members')
      .insert({
        organization_id: member.organization_id,
        user_id: newUser.user.id,
        role: 'owner',
      });

    if (memberError2) {
      // Rollback: delete owner_users record and user
      await supabaseAdmin.from('owner_users').delete().eq('user_id', newUser.user.id);
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw new Error(`Failed to add user to organization: ${memberError2.message}`);
    }

    console.log(`Owner ${ownerId} invited successfully with email ${email}`);

    return new Response(
      JSON.stringify({ success: true, userId: newUser.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error inviting owner:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
