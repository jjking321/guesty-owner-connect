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

      // Direct memberships
      const { data: members } = await supabase
        .from('organization_members')
        .select('role, organization_id')
        .eq('user_id', user.id);

      const directMemberships = (members || []) as Array<{ role: OrgMembership['role']; organization_id: string }>;
      const isSuperAdmin = directMemberships.some(m => m.role === 'super_admin');

      // Super admins can access ALL organizations
      let memberships: OrgMembership[] = [];
      if (isSuperAdmin) {
        const { data: allOrgs } = await supabase.rpc('get_accessible_organizations');
        memberships = (allOrgs || []).map((o: any) => ({
          organizationId: o.id,
          organizationName: o.name,
          role: o.role,
        }));
      } else {
        const orgIds = directMemberships.map(m => m.organization_id);
        const { data: orgs } = orgIds.length
          ? await supabase.from('organizations').select('id, name').in('id', orgIds)
          : { data: [] as any[] };
        const nameById = new Map((orgs || []).map((o: any) => [o.id, o.name]));
        memberships = directMemberships.map(m => ({
          organizationId: m.organization_id,
          organizationName: nameById.get(m.organization_id) || 'Organization',
          role: m.role,
        }));
      }

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
