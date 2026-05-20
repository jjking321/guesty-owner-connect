## Goal

A super admin should be a super admin of every organization and should be able to toggle between them. Only an existing super admin can grant the super_admin role to another user.

## What to change

### 1. Backfill: make every existing super admin a member of every org

Insert a `super_admin` row in `organization_members` for each (super_admin user × organization) pair that doesn't already exist. This immediately fixes Jeff's toggle to Renjoy — when he switches, RLS will pass and he'll see Renjoy's listings, reservations, etc.

### 2. Auto-add new super admins to all orgs

Database trigger on `organization_members`: when a row is inserted/updated with `role = 'super_admin'`, also insert a `super_admin` row for that user in every other organization (idempotent via `ON CONFLICT DO NOTHING`).

### 3. Auto-add all existing super admins to any new org

Database trigger on `organizations`: when a new org is created, insert a `super_admin` membership row for every user who is a super_admin anywhere.

### 4. Restrict who can create super admins

Replace the current "admins and super_admins can insert/update members" policies with split rules:

- Inserting/updating a row with `role = 'super_admin'` → only existing super admins (anywhere) can do this.
- Inserting/updating a row with `role IN ('admin', 'member')` → current rule (org admins or super admins of that org) still applies.

Same split on the invitation table — only a super admin can send an invite with `role = 'super_admin'`.

### 5. Front-end: invalidate queries on org switch

The `OrganizationSwitcher` already writes to localStorage and dispatches `active-organization-changed`. Wire a small listener at the app root that calls `queryClient.invalidateQueries()` (and `queryClient.clear()` for caches keyed on org) when that event fires, so the listings/reservations refetch under the new org context without a hard page reload.

### 6. Hide the "Add super admin" option in the Team UI

In `TeamManagement.tsx`, only show the "super_admin" choice in the role selector if `useUserRole().role === 'super_admin'`. Other admins can only invite/promote up to `admin`.

## Technical details

- New helper function: `is_super_admin_anywhere(uuid) returns boolean` (already added in prior migration — reuse it).
- New trigger functions: `sync_super_admin_to_all_orgs()` on `organization_members` AFTER INSERT/UPDATE, and `seed_super_admins_to_new_org()` on `organizations` AFTER INSERT.
- RLS replacement on `organization_members` and `organization_invitations`: two INSERT policies and two UPDATE policies — one for super_admin role assignments (gated by `is_super_admin_anywhere(auth.uid())`) and one for non-super_admin roles (current rule).
- Frontend touchpoints: `src/App.tsx` (or `main.tsx`) to add the org-change → invalidateQueries listener; `src/components/TeamManagement.tsx` to filter the role options.
- No edge-function changes needed.

## Out of scope

- Existing admins/members keep their per-org scoping. This change only affects the super_admin role.
- No UI for revoking super_admin across all orgs at once — removing the home-org membership doesn't auto-remove the propagated ones (we can add that later if you want).
