import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Member {
  id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
  profiles: {
    email: string;
    full_name?: string;
  };
}

export function TeamManagement() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('member');
  const [showInviteForm, setShowInviteForm] = useState(false);

  useEffect(() => {
    loadTeamMembers();
  }, []);

  const loadTeamMembers = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get user's organization
      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id)
        .single();

      if (!membership) {
        toast({
          title: "No organization found",
          description: "Please contact support",
          variant: "destructive",
        });
        return;
      }

      setOrganizationId(membership.organization_id);
      setCurrentUserRole(membership.role);

      // Get all members of the organization
      const { data: membersData, error } = await supabase
        .from("organization_members")
        .select(`
          id,
          user_id,
          role,
          created_at,
          profiles:user_id (
            email,
            full_name
          )
        `)
        .eq("organization_id", membership.organization_id)
        .order("created_at");

      if (error) throw error;

      setMembers(membersData as any || []);
    } catch (error: any) {
      toast({
        title: "Error loading team members",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!organizationId) return;

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const role = formData.get("role") as 'owner' | 'admin' | 'member';

    try {
      setInviting(true);

      // Check if user exists
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", email)
        .single();

      if (!profile) {
        toast({
          title: "User not found",
          description: "The user must sign up first before being added to the organization",
          variant: "destructive",
        });
        return;
      }

      // Add member to organization
      const { error } = await supabase
        .from("organization_members")
        .insert({
          organization_id: organizationId,
          user_id: profile.id,
          role: role,
        });

      if (error) {
        if (error.code === '23505') {
          toast({
            title: "User already a member",
            description: "This user is already a member of your organization",
            variant: "destructive",
          });
        } else {
          throw error;
        }
        return;
      }

      toast({
        title: "Member added",
        description: `${email} has been added to your organization`,
      });

      setShowInviteForm(false);
      (e.target as HTMLFormElement).reset();
      loadTeamMembers();
    } catch (error: any) {
      toast({
        title: "Error adding member",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId: string, userEmail: string) => {
    try {
      const { error } = await supabase
        .from("organization_members")
        .delete()
        .eq("id", memberId);

      if (error) throw error;

      toast({
        title: "Member removed",
        description: `${userEmail} has been removed from your organization`,
      });

      loadTeamMembers();
    } catch (error: any) {
      toast({
        title: "Error removing member",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: 'owner' | 'admin' | 'member') => {
    try {
      const { error } = await supabase
        .from("organization_members")
        .update({ role: newRole })
        .eq("id", memberId);

      if (error) throw error;

      toast({
        title: "Role updated",
        description: "Member role has been updated",
      });

      loadTeamMembers();
    } catch (error: any) {
      toast({
        title: "Error updating role",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const canManageMembers = currentUserRole === 'owner' || currentUserRole === 'admin';

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Members
            </CardTitle>
            <CardDescription>
              Manage who has access to your organization
            </CardDescription>
          </div>
          {canManageMembers && (
            <Button
              onClick={() => setShowInviteForm(!showInviteForm)}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Member
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showInviteForm && canManageMembers && (
          <form onSubmit={handleInviteMember} className="space-y-4 p-4 border rounded-lg">
            <div className="grid gap-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="colleague@example.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Select name="role" defaultValue="member" required>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Owners and Admins can manage team members and settings
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={inviting}>
                {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Member
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowInviteForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="flex-1">
                <div className="font-medium">
                  {member.profiles?.full_name || member.profiles?.email}
                </div>
                <div className="text-sm text-muted-foreground">
                  {member.profiles?.email}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canManageMembers && member.role !== 'owner' ? (
                  <Select
                    value={member.role}
                    onValueChange={(value) => handleUpdateRole(member.id, value as any)}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="owner">Owner</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                    {member.role}
                  </Badge>
                )}
                {canManageMembers && member.role !== 'owner' && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove member?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to remove {member.profiles?.email} from the organization?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleRemoveMember(member.id, member.profiles?.email)}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
