

# Fix Sidebar Access for michael@renjoy.com

## Problem

Michael (`michael@renjoy.com`) cannot see the sidebar because they have no organization membership. The sidebar visibility depends on the user's role, which is retrieved from the `organization_members` table via the `useUserRole` hook. Currently, Michael exists in the system but has no role assigned.

**Current State:**
| Table | Status |
|-------|--------|
| `auth.users` | User exists (`14385d36-cc49-45f5-a540-800bbc80e3bf`) |
| `profiles` | Profile exists |
| `organization_members` | **Missing - no membership** |

## Solution

Create a new organization for Renjoy and add Michael as the super_admin.

## Data Changes Required

### Step 1: Create the Renjoy organization

```sql
INSERT INTO organizations (id, name)
VALUES (gen_random_uuid(), 'Renjoy');
```

### Step 2: Add Michael as super_admin to the new organization

```sql
INSERT INTO organization_members (organization_id, user_id, role)
SELECT 
  o.id,
  '14385d36-cc49-45f5-a540-800bbc80e3bf',
  'super_admin'
FROM organizations o
WHERE o.name = 'Renjoy';
```

## Expected Result

After these changes:
- Michael will have the `super_admin` role for the Renjoy organization
- The `useUserRole` hook will return `role: 'super_admin'` for Michael
- The sidebar will display all menu items available to super_admins:
  - Portfolio View
  - Goals Review  
  - Groups
  - Owners
  - Reservations
  - Reviews
  - Forecast Admin
  - Comparables
  - Settings

## Additional Note

Since this is a new organization, Michael will start with no data (no listings, no reservations, etc.). They will need to connect a Guesty account in Settings to sync property data into their organization.

