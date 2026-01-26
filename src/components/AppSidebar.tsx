import { Calendar, Settings, FolderOpen, LayoutGrid, Users, Wrench, Star, Building2, Target } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useUserRole } from "@/hooks/useUserRole";

const menuItems = [
  { title: "Portfolio View", url: "/properties/bulk-edit", icon: LayoutGrid, roles: ['super_admin', 'admin', 'member'] },
  { title: "Goals Review", url: "/goals-review", icon: Target, roles: ['super_admin', 'admin', 'member'] },
  { title: "Groups", url: "/groups", icon: FolderOpen, roles: ['super_admin', 'admin', 'member', 'owner'] },
  { title: "Owners", url: "/owners", icon: Users, roles: ['super_admin', 'admin', 'member'] },
  { title: "Reservations", url: "/reservations", icon: Calendar, roles: ['super_admin', 'admin', 'member'] },
  { title: "Reviews", url: "/reviews", icon: Star, roles: ['super_admin', 'admin', 'member'] },
  { title: "Forecast Admin", url: "/forecast-admin", icon: Wrench, roles: ['super_admin', 'admin'] },
  { title: "Comparables", url: "/comparables", icon: Building2, roles: ['super_admin', 'admin'] },
  { title: "Settings", url: "/settings", icon: Settings, roles: ['super_admin', 'admin', 'member'] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { role, ownerId } = useUserRole();
  const isCollapsed = state === "collapsed";
  
  const filteredMenuItems = menuItems.filter(item => 
    role && item.roles.includes(role)
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {role === 'owner' ? 'Owner Portal' : 'RevMan'}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {role === 'owner' && ownerId && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={`/owners/${ownerId}`}
                      className={({ isActive }) =>
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : ""
                      }
                    >
                      <Users className="h-4 w-4" />
                      {!isCollapsed && <span>My Dashboard</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {filteredMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className={({ isActive }) =>
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : ""
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
