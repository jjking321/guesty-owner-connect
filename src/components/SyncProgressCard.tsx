import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Loader2, X, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface SyncJob {
  id: string;
  sync_type: string;
  status: string;
  progress_message: string | null;
  items_synced: number | null;
  total_items: number | null;
  error_message: string | null;
  last_synced_offset?: number | null;
}

interface SyncProgressCardProps {
  accountId: string;
  syncType: 'listings' | 'reservations' | 'reviews' | 'new_reservations' | 'capacity_calendar' | 'comparable_historical' | 'comparable_future_rates' | 'airbnb_ratings';
  onComplete?: () => void;
}

const getSyncTypeName = (type: string): string => {
  switch (type) {
    case 'capacity_calendar': return 'Calendar Sync';
    case 'comparable_historical': return 'Historical Metrics Fetch';
    case 'comparable_future_rates': return 'Future Rates Fetch';
    case 'new_reservations': return 'New Reservations Sync';
    case 'airbnb_ratings': return 'Airbnb Ratings Scrape';
    default: return `${type.charAt(0).toUpperCase() + type.slice(1)} Sync`;
  }
};

export function SyncProgressCard({ accountId, syncType, onComplete }: SyncProgressCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    // Reset dismissed state when account or sync type changes
    setDismissed(false);
    
    // Load existing active job on mount - prioritize running jobs, then recent jobs
    const loadActiveJob = async () => {
      // First try to find any running job (no time limit for running jobs)
      const { data: runningJob } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('guesty_account_id', accountId)
        .eq('sync_type', syncType)
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (runningJob) {
        setSyncJob(runningJob as SyncJob);
        setDismissed(false);
        return;
      }
      
      // Check for resumable failed jobs (no time limit) - these persist until dismissed or resumed
      // BUT only if there's no successful sync after the failed one
      const { data: resumableJob } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('guesty_account_id', accountId)
        .eq('sync_type', syncType)
        .eq('status', 'failed')
        .gt('last_synced_offset', 0)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (resumableJob) {
        // Check if there's a completed sync after this failed one
        const { data: laterCompletedJob } = await supabase
          .from('sync_jobs')
          .select('id')
          .eq('guesty_account_id', accountId)
          .eq('sync_type', syncType)
          .in('status', ['completed', 'completed_with_errors'])
          .gt('started_at', resumableJob.started_at)
          .limit(1)
          .maybeSingle();
        
        // Only show resumable job if no successful sync happened after it
        if (!laterCompletedJob) {
          setSyncJob(resumableJob as SyncJob);
          setDismissed(false);
          return;
        }
      }
      
      // If no running or resumable job, look for recent completed/failed jobs (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentJob } = await supabase
        .from('sync_jobs')
        .select('*')
        .eq('guesty_account_id', accountId)
        .eq('sync_type', syncType)
        .gte('started_at', fiveMinutesAgo)
        .in('status', ['completed', 'completed_with_errors', 'failed'])
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (recentJob) {
        setSyncJob(recentJob as SyncJob);
        setDismissed(false);
        
        // Auto-clear completed/failed jobs after delay
        setTimeout(() => setSyncJob(null), 10000); // 10 seconds
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
            
            // Handle completed/failed jobs
            if (job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'failed') {
              // Invalidate comparables query to refresh data
              if (syncType === 'comparable_historical' || syncType === 'comparable_future_rates') {
                queryClient.invalidateQueries({ queryKey: ['all-comparables'] });
              }
              
              // Call onComplete callback
              if (onComplete) {
                onComplete();
              }
              
              // Only auto-clear if job is not resumable
              // Resumable jobs (failed with offset > 0) stay visible until dismissed
              if (job.status === 'completed' || job.status === 'completed_with_errors') {
                setTimeout(() => setSyncJob(null), 30000); // 30 seconds
              } else if (job.status === 'failed') {
                // Only auto-clear failed jobs that can't be resumed
                if (!job.last_synced_offset || job.last_synced_offset === 0) {
                  setTimeout(() => setSyncJob(null), 30000);
                }
                // Resumable failed jobs stay visible until dismissed or resumed
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, syncType, queryClient, onComplete]);

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
        description: "The synchronization has been cancelled",
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

  const handleResumeCalendar = async () => {
    if (!syncJob) return;
    
    try {
      setStopping(true);
      const { data, error } = await supabase.functions.invoke('sync-bulk-calendar', {
        body: { guestyAccountId: accountId }
      });
      
      if (error) throw error;
      
      toast({
        title: "Calendar sync resumed",
        description: "Calendar sync has been resumed from where it left off",
      });
    } catch (error: any) {
      toast({
        title: "Failed to resume calendar sync",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setStopping(false);
    }
  };

  const handleResumeReservations = async () => {
    if (!syncJob) return;
    
    try {
      setStopping(true);
      const { data, error } = await supabase.functions.invoke('sync-guesty-data', {
        body: { accountId, syncType: 'reservations' }
      });
      
      if (error) throw error;
      
      toast({
        title: "Reservations sync resumed",
        description: "Sync has been resumed from where it left off",
      });
    } catch (error: any) {
      toast({
        title: "Failed to resume reservations sync",
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

  const isCompleted = syncJob.status === 'completed' || syncJob.status === 'completed_with_errors';
  const isFailed = syncJob.status === 'failed';
  const canResume = isFailed && syncJob.last_synced_offset && syncJob.last_synced_offset > 0;
  
  // Show progress for running jobs AND resumable failed jobs (so user sees where they left off)
  const showProgress = (syncJob.status === 'running' || canResume) && 
    (syncJob.items_synced !== null || syncJob.total_items !== null);

  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {syncJob.status === 'running' && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              {isCompleted && (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              {isFailed && (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <p className="font-medium text-sm">
                {getSyncTypeName(syncType)} - {syncJob.status === 'completed_with_errors' ? 'Completed with errors' : syncJob.status}
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
              
              {/* Resume button - show for failed capacity_calendar or reservations with offset > 0 */}
              {isFailed && syncType === 'capacity_calendar' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleResumeCalendar}
                  disabled={stopping}
                >
                  <Loader2 className={`h-3 w-3 mr-1 ${stopping ? 'animate-spin' : ''}`} />
                  Resume
                </Button>
              )}
              
              {/* Resume button for reservations with progress to resume from */}
              {isFailed && syncType === 'reservations' && syncJob.last_synced_offset && syncJob.last_synced_offset > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleResumeReservations}
                  disabled={stopping}
                >
                  <Loader2 className={`h-3 w-3 mr-1 ${stopping ? 'animate-spin' : ''}`} />
                  Resume from {syncJob.last_synced_offset.toLocaleString()}
                </Button>
              )}
              
              {/* Resume button for airbnb_ratings with progress to resume from */}
              {isFailed && syncType === 'airbnb_ratings' && syncJob.last_synced_offset && syncJob.last_synced_offset > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={async () => {
                    try {
                      setStopping(true);
                      const { error } = await supabase.functions.invoke('bulk-scrape-airbnb-ratings', {});
                      if (error) throw error;
                      toast({
                        title: "Airbnb ratings scrape resumed",
                        description: "Scraping has been resumed from where it left off",
                      });
                    } catch (error: any) {
                      toast({
                        title: "Failed to resume scrape",
                        description: error.message,
                        variant: "destructive",
                      });
                    } finally {
                      setStopping(false);
                    }
                  }}
                  disabled={stopping}
                >
                  <Loader2 className={`h-3 w-3 mr-1 ${stopping ? 'animate-spin' : ''}`} />
                  Resume from {syncJob.last_synced_offset.toLocaleString()}
                </Button>
              )}
              
              {/* Dismiss button - only show for completed/failed */}
              {(isCompleted || isFailed) && (
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
