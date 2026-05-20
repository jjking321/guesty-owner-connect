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
import { Loader2, Plus, Trash2, Users, Mail, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Member {
  id: string;
  user_id: string;
  role: 'super_admin' | 'admin' | 'member';
  created_at: string;
  profiles: {
    email: string;
    full_name?: string;
  };
}

interface PendingInvitation {
  id: string;
  email: string;
  role: 'super_admin' | 'admin' | 'member' | 'owner';
  expires_at: string;
  token: string;
}

const formatRole = (role: string) => {
  switch(role) {
    case 'super_admin': return 'Super Admin';
    case 'admin': return 'Admin';
    case 'member': return 'Member';
    default: return role;
  }
};

export function TeamManagement() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('member');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);

  useEffect(() => {
    loadTeamMembers();
  }, []);

  const loadTeamMembers = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      setCurrentUserId(user.id);

      // Determine active organization (profile-driven, falls back to first membership)
      const { data: profile } = await supabase
        .from("profiles")
        .select("active_organization_id")
        .eq("id", user.id)
        .maybeSingle();

      let activeOrgId = profile?.active_organization_id as string | null;

      // Get the user's membership in the active org (or fall back)
      let membershipQuery = supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id);
      if (activeOrgId) membershipQuery = membershipQuery.eq("organization_id", activeOrgId);
      const { data: memberships } = await membershipQuery.limit(1);
      const membership = memberships?.[0];

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
        .select("id, user_id, role, created_at")
        .eq("organization_id", membership.organization_id)
        .order("created_at");

      if (error) throw error;

      // Fetch profiles separately (avoids relationship cache issues)
      const userIds = (membersData || []).map((m) => m.user_id);
      let profilesById: Record<string, { email: string; full_name?: string }> = {};
      if (userIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", userIds);
        for (const p of profilesData || []) {
          profilesById[p.id] = { email: p.email, full_name: p.full_name ?? undefined };
        }
      }

      setMembers(
        (membersData || []).map((m) => ({
          ...m,
          profiles: profilesById[m.user_id] || { email: "(unknown)" },
        })) as any
      );

      // Get pending invitations
      const { data: invitationsData, error: invitationsError } = await supabase
        .from("organization_invitations")
        .select("*")
        .eq("organization_id", membership.organization_id)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });

      if (invitationsError) throw invitationsError;

      setPendingInvitations(invitationsData || []);
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
    const role = formData.get("role") as 'super_admin' | 'admin' | 'member';

    try {
      setInviting(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if invitation already exists
      const { data: existingInvitation } = await supabase
        .from('organization_invitations')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('email', email)
        .maybeSingle();

      // Delete existing invitation if found
      if (existingInvitation) {
        await supabase
          .from('organization_invitations')
          .delete()
          .eq('id', existingInvitation.id);
      }

      // Generate invitation token
      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      // Create invitation
      const { error: inviteError } = await supabase
        .from('organization_invitations')
        .insert({
          organization_id: organizationId,
          email: email,
          role: role,
          invited_by: user.id,
          token: token,
          expires_at: expiresAt.toISOString(),
        });

      if (inviteError) throw inviteError;

      // Generate invitation link
      const inviteUrl = `${window.location.origin}/accept-invitation?token=${token}`;
      
      // Copy to clipboard
      await navigator.clipboard.writeText(inviteUrl);
      
      toast({
        title: "Invitation created",
        description: existingInvitation 
          ? "Previous invitation replaced. New link copied to clipboard!"
          : "Invitation link copied to clipboard! Share it with the user.",
      });

      setShowInviteForm(false);
      (e.target as HTMLFormElement).reset();
      loadTeamMembers();
    } catch (error: any) {
      toast({
        title: "Error creating invitation",
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

  const handleUpdateRole = async (memberId: string, newRole: 'super_admin' | 'admin' | 'member') => {
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

  const handleRevokeInvitation = async (invitationId: string, email: string) => {
    try {
      const { error } = await supabase
        .from("organization_invitations")
        .delete()
        .eq("id", invitationId);

      if (error) throw error;

      toast({
        title: "Invitation revoked",
        description: `Invitation for ${email} has been revoked`,
      });

      loadTeamMembers();
    } catch (error: any) {
      toast({
        title: "Error revoking invitation",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCopyInviteLink = async (token: string) => {
    const inviteUrl = `${window.location.origin}/accept-invitation?token=${token}`;
    await navigator.clipboard.writeText(inviteUrl);
    
    toast({
      title: "Link copied",
      description: "Invitation link copied to clipboard",
    });
  };

  const canManageMembers = currentUserRole === 'super_admin' || currentUserRole === 'admin';

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
                  {currentUserRole === 'super_admin' && (
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                An invitation link will be generated that you can share with the user
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

        <div className="space-y-4">
          {pendingInvitations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Pending Invitations
              </h3>
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-4 border rounded-lg bg-muted/50"
                >
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      {invitation.email}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Expires {new Date(invitation.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                      Pending
                    </Badge>
                    <Badge variant="secondary">
                      {formatRole(invitation.role)}
                    </Badge>
                    {canManageMembers && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyInviteLink(invitation.token)}
                        >
                          Copy Link
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to revoke the invitation for {invitation.email}?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRevokeInvitation(invitation.id, invitation.email)}
                              >
                                Revoke
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Active Members
            </h3>
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
                  {(() => {
                    const isSelf = currentUserId === member.user_id;
                    // Super admins can manage everyone except themselves.
                    // Regular admins can manage only non-super_admin members.
                    const canEditThisRow =
                      !isSelf &&
                      canManageMembers &&
                      (currentUserRole === 'super_admin' || member.role !== 'super_admin');

                    return (
                      <>
                        {canEditThisRow ? (
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
                              {currentUserRole === 'super_admin' && (
                                <SelectItem value="super_admin">Super Admin</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={member.role === 'super_admin' ? 'default' : 'secondary'}>
                            {formatRole(member.role)}
                          </Badge>
                        )}
                        {canEditThisRow && (
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
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
