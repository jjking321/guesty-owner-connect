import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

type Role = 'super_admin' | 'admin' | 'member' | 'owner';

export interface OrgMembership {
  organizationId: string;
  organizationName: string;
  role: 'super_admin' | 'admin' | 'member';
}

interface UserRoleData {
  role: Role | null;
  ownerId: string | null;
  organizationId: string | null;
  memberships: OrgMembership[];
  loading: boolean;
  switchOrganization: (orgId: string) => void;
}

const ACTIVE_ORG_KEY = 'activeOrganizationId';

// Lightweight event so components re-fetch on switch
const ORG_CHANGE_EVENT = 'active-organization-changed';

export function useUserRole(): UserRoleData {
  const [state, setState] = useState<Omit<UserRoleData, 'switchOrganization'>>({
    role: null,
    ownerId: null,
    organizationId: null,
    memberships: [],
    loading: true,
  });

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState({ role: null, ownerId: null, organizationId: null, memberships: [], loading: false });
        return;
      }

      // Owner check first
      const { data: ownerUser } = await supabase
        .from('owner_users')
        .select('owner_id, organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (ownerUser) {
        setState({
          role: 'owner',
          ownerId: ownerUser.owner_id,
          organizationId: ownerUser.organization_id,
          memberships: [],
          loading: false,
        });
        return;
      }

      // All organization memberships
      const { data: members } = await supabase
        .from('organization_members')
        .select('role, organization_id, organizations(name)')
        .eq('user_id', user.id);

      const memberships: OrgMembership[] = (members || []).map((m: any) => ({
        organizationId: m.organization_id,
        organizationName: m.organizations?.name || 'Organization',
        role: m.role,
      }));

      if (memberships.length === 0) {
        setState({ role: null, ownerId: null, organizationId: null, memberships: [], loading: false });
        return;
      }

      const stored = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_ORG_KEY) : null;
      const active = memberships.find(m => m.organizationId === stored) || memberships[0];
      if (stored !== active.organizationId) {
        localStorage.setItem(ACTIVE_ORG_KEY, active.organizationId);
      }

      setState({
        role: active.role,
        ownerId: null,
        organizationId: active.organizationId,
        memberships,
        loading: false,
      });
    } catch (e) {
      console.error('Error loading user role:', e);
      setState({ role: null, ownerId: null, organizationId: null, memberships: [], loading: false });
    }
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener(ORG_CHANGE_EVENT, handler);
    return () => window.removeEventListener(ORG_CHANGE_EVENT, handler);
  }, [load]);

  const switchOrganization = useCallback((orgId: string) => {
    localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    window.dispatchEvent(new Event(ORG_CHANGE_EVENT));
  }, []);

  return { ...state, switchOrganization };
}
