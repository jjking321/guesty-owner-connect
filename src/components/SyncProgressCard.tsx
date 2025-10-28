import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Loader2, X, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface SyncJob {
  id: string;
  sync_type: string;
  status: string;
  progress_message: string | null;
  items_synced: number | null;
  total_items: number | null;
  error_message: string | null;
}

interface SyncProgressCardProps {
  accountId: string;
  syncType: 'listings' | 'reservations' | 'reviews';
}

export function SyncProgressCard({ accountId, syncType }: SyncProgressCardProps) {
  const { toast } = useToast();
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    // Reset dismissed state when account or sync type changes
    setDismissed(false);
    
    // Load existing active job on mount - only show recent jobs (within last 5 minutes)
    const loadActiveJob = async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const { data } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('guesty_account_id', accountId)
        .eq('sync_type', syncType)
        .gte('started_at', fiveMinutesAgo)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) {
        setSyncJob(data as SyncJob);
        setDismissed(false); // Show new job
        
        // Auto-clear completed/failed jobs after delay
        if (data.status === 'completed' || data.status === 'failed') {
          setTimeout(() => setSyncJob(null), 10000); // 10 seconds
        }
      }
    };
    
    loadActiveJob();

    // Subscribe to sync_jobs updates for this account and sync type
    const channel = supabase
      .channel(`sync_jobs_${accountId}_${syncType}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_jobs',
          filter: `guesty_account_id=eq.${accountId}`,
        },
        (payload) => {
          const job = payload.new as SyncJob;
          if (job && job.sync_type === syncType) {
            setSyncJob(job);
            setDismissed(false); // Show new job, clear any previous dismissal
            
            // Auto-clear after completed/failed
            if (job.status === 'completed' || job.status === 'failed') {
              setTimeout(() => setSyncJob(null), 30000); // 30 seconds
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, syncType]);

  const handleDismiss = () => {
    setDismissed(true);
    setSyncJob(null);
  };

  const handleStop = async () => {
    if (!syncJob) return;
    
    try {
      setStopping(true);
      const { error } = await supabase.rpc('cancel_sync_job', { job_id: syncJob.id });
      
      if (error) throw error;
      
      toast({
        title: "Sync stopped",
        description: "The sync operation has been cancelled.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to stop sync",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setStopping(false);
    }
  };

  if (!syncJob || dismissed) return null;

  const progress = syncJob.total_items && syncJob.items_synced
    ? (syncJob.items_synced / syncJob.total_items) * 100
    : undefined;

  const showProgress = syncJob.status === 'running' && (syncJob.items_synced !== null || syncJob.total_items !== null);

  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {syncJob.status === 'running' && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              {syncJob.status === 'completed' && (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              {syncJob.status === 'failed' && (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <p className="font-medium text-sm capitalize">
                {syncType} Sync - {syncJob.status}
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Show count badge */}
              {showProgress && (
                <div className="text-xs font-mono bg-primary/10 px-2 py-1 rounded">
                  {syncJob.items_synced?.toLocaleString() || 0}
                  {syncJob.total_items && ` / ${syncJob.total_items.toLocaleString()}`}
                </div>
              )}
              
              {/* Stop button - only show for running syncs */}
              {syncJob.status === 'running' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleStop}
                  disabled={stopping}
                >
                  <StopCircle className="h-3 w-3 mr-1" />
                  Stop
                </Button>
              )}
              
              {/* Dismiss button - only show for completed/failed */}
              {(syncJob.status === 'completed' || syncJob.status === 'failed') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleDismiss}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {syncJob.progress_message || 'Processing...'}
            </p>

            {/* Always show progress bar when we have progress data */}
            {progress !== undefined && showProgress && (
              <div className="space-y-1">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-right text-muted-foreground">
                  {Math.round(progress)}%
                </p>
              </div>
            )}
          </div>

          {syncJob.error_message && (
            <p className="text-sm text-destructive">
              Error: {syncJob.error_message}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
