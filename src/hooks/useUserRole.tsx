import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UserRoleData {
  role: 'super_admin' | 'admin' | 'member' | 'owner' | null;
  ownerId: string | null;
  organizationId: string | null;
  loading: boolean;
}

export function useUserRole(): UserRoleData {
  const [roleData, setRoleData] = useState<UserRoleData>({
    role: null,
    ownerId: null,
    organizationId: null,
    loading: true,
  });

  useEffect(() => {
    const loadUserRole = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setRoleData({ role: null, ownerId: null, organizationId: null, loading: false });
          return;
        }

        // Check if user is an owner first
        const { data: ownerUser } = await supabase
          .from('owner_users')
          .select('owner_id, organization_id')
          .eq('user_id', user.id)
          .single();

        if (ownerUser) {
          // User is an owner
          setRoleData({
            role: 'owner',
            ownerId: ownerUser.owner_id,
            organizationId: ownerUser.organization_id,
            loading: false,
          });
          return;
        }

        // Check organization member role
        const { data: member } = await supabase
          .from('organization_members')
          .select('role, organization_id')
          .eq('user_id', user.id)
          .single();

        if (member) {
          setRoleData({
            role: member.role as 'super_admin' | 'admin' | 'member',
            ownerId: null,
            organizationId: member.organization_id,
            loading: false,
          });
        } else {
          setRoleData({ role: null, ownerId: null, organizationId: null, loading: false });
        }
      } catch (error) {
        console.error('Error loading user role:', error);
        setRoleData({ role: null, ownerId: null, organizationId: null, loading: false });
      }
    };

    loadUserRole();
  }, []);

  return roleData;
}
