import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

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
  syncType: 'listings' | 'reservations';
}

export function SyncProgressCard({ accountId, syncType }: SyncProgressCardProps) {
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);

  useEffect(() => {
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
            
            // Clear after completed/failed
            if (job.status === 'completed' || job.status === 'failed') {
              setTimeout(() => setSyncJob(null), 5000);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, syncType]);

  if (!syncJob) return null;

  const progress = syncJob.total_items && syncJob.items_synced
    ? (syncJob.items_synced / syncJob.total_items) * 100
    : undefined;

  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardContent className="p-4">
        <div className="space-y-3">
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
              {syncType} Sync
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            {syncJob.progress_message || 'Processing...'}
          </p>

          {progress !== undefined && syncJob.status === 'running' && (
            <Progress value={progress} className="h-2" />
          )}

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
