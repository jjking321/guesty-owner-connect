import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function AcceptInvitation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<any>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const token = searchParams.get('token');

  useEffect(() => {
    checkInvitation();
  }, [token]);

  const checkInvitation = async () => {
    if (!token) {
      toast.error('Invalid invitation link');
      navigate('/');
      return;
    }

    try {
      // Get invitation details first (no auth required for lookup)
      const { data: inviteData, error: inviteError } = await supabase
        .from('organization_invitations')
        .select('*, organizations(name)')
        .eq('token', token)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (inviteError || !inviteData) {
        toast.error('Invalid or expired invitation');
        navigate('/');
        return;
      }

      setInvitation(inviteData);

      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserEmail(user?.email ?? null);

      if (!user) {
        setLoading(false);
        return;
      }

      // If logged in with the correct email, auto-accept the invitation
      if (user.email?.toLowerCase() === inviteData.email.toLowerCase()) {
        await acceptInvitation(user.id);
        return;
      }

      // Logged in as someone else
      toast.error(`Please log in with ${inviteData.email} to accept this invitation`);
      setLoading(false);
      return;

    } catch (error: any) {
      console.error('Error checking invitation:', error);
      toast.error('Failed to check invitation');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const acceptInvitation = async (userId: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('accept_organization_invitation', {
        _token: token,
        _user_id: userId,
      });

      if (error) throw error;

      const result = data as { success: boolean; message?: string; error?: string };

      if (result?.success) {
        toast.success('Successfully joined the organization!');
        navigate('/properties/bulk-edit');
      } else {
        toast.error(result?.error || 'Failed to accept invitation');
        setLoading(false);
      }
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      toast.error(error.message || 'Failed to accept invitation');
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Not authenticated');
      return;
    }
    await acceptInvitation(user.id);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const handleGoToAuth = () => {
    const redirect = `/accept-invitation?token=${token}`;
    navigate(
      `/auth?redirect=${encodeURIComponent(redirect)}&email=${encodeURIComponent(invitation?.email ?? '')}`
    );
  };

  const isLoggedInWithCorrectEmail =
    !!currentUserEmail &&
    !!invitation?.email &&
    currentUserEmail.toLowerCase() === invitation.email.toLowerCase();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Organization Invitation</CardTitle>
          <CardDescription>
            You've been invited to join {invitation?.organizations?.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">Email:</span> {invitation?.email}
            </p>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">Role:</span>{' '}
              <span className="capitalize">{invitation?.role}</span>
            </p>
          </div>

          {isLoggedInWithCorrectEmail ? (
            <Button onClick={handleAcceptInvitation} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Accepting...
                </>
              ) : (
                'Accept Invitation'
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Please sign up or log in with{' '}
                <span className="font-semibold">{invitation?.email}</span> to accept this
                invitation.
              </p>
              <Button onClick={handleGoToAuth} className="w-full">
                Continue to Sign In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
