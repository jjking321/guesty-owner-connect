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
      
      if (!user) {
        // Don't redirect yet, let user see invitation details
        setLoading(false);
        return;
      }

      // Check if logged-in user's email matches invitation
      if (user.email !== inviteData.email) {
        toast.error(`Please log in with ${inviteData.email} to accept this invitation`);
        setLoading(false);
        return;
      }

    } catch (error: any) {
      console.error('Error checking invitation:', error);
      toast.error('Failed to check invitation');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    if (!token) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Call the accept invitation function
      const { data, error } = await supabase.rpc('accept_organization_invitation', {
        _token: token,
        _user_id: user.id,
      });

      if (error) throw error;

      const result = data as { success: boolean; message?: string; error?: string };
      
      if (result?.success) {
        toast.success('Successfully joined the organization!');
        navigate('/dashboard');
      } else {
        toast.error(result?.error || 'Failed to accept invitation');
      }
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      toast.error(error.message || 'Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const handleGoToAuth = () => {
    navigate(`/auth?redirect=/accept-invitation?token=${token}&email=${invitation?.email}`);
  };

  const checkIfLoggedInWithCorrectEmail = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email === invitation?.email;
  };

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
              <span className="font-semibold">Role:</span> <span className="capitalize">{invitation?.role}</span>
            </p>
          </div>
          
          {checkIfLoggedInWithCorrectEmail() ? (
            <Button 
              onClick={handleAcceptInvitation} 
              disabled={loading}
              className="w-full"
            >
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
                Please sign up or log in with <span className="font-semibold">{invitation?.email}</span> to accept this invitation.
              </p>
              <Button 
                onClick={handleGoToAuth}
                className="w-full"
              >
                Continue to Sign In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
