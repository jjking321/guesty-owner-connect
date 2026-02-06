import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ProgressData {
  id: string;
  status: string;
  total_reviews: number;
  completed_reviews: number;
  failed_reviews: number;
  skipped_reviews: number;
  current_guest_name: string | null;
  error_message: string | null;
}

interface BatchAnalysisProgressProps {
  progressId: string | null;
  onComplete: () => void;
  onCancel: () => void;
}

export function BatchAnalysisProgress({ progressId, onComplete, onCancel }: BatchAnalysisProgressProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    if (!progressId) return;

    // Initial fetch
    const fetchProgress = async () => {
      const { data, error } = await supabase
        .from('dispute_analysis_progress')
        .select('*')
        .eq('id', progressId)
        .single();

      if (error) {
        console.error('Failed to fetch progress:', error);
        return;
      }

      setProgress(data as ProgressData);
    };

    fetchProgress();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`dispute_progress_${progressId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'dispute_analysis_progress',
          filter: `id=eq.${progressId}`,
        },
        (payload) => {
          const newData = payload.new as ProgressData;
          setProgress(newData);

          // If completed, show success state briefly then dismiss
          if (newData.status === 'completed') {
            setShowComplete(true);
            setTimeout(() => {
              onComplete();
            }, 2000);
          } else if (newData.status === 'failed' || newData.status === 'cancelled') {
            setTimeout(() => {
              onComplete();
            }, 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [progressId, onComplete]);

  const handleCancel = async () => {
    if (!progressId) return;

    await supabase
      .from('dispute_analysis_progress')
      .update({ status: 'cancelled' })
      .eq('id', progressId);

    onCancel();
  };

  if (!progressId || !progress) return null;

  const totalProcessed = progress.completed_reviews + progress.failed_reviews + progress.skipped_reviews;
  const percentComplete = progress.total_reviews > 0 
    ? Math.round((totalProcessed / progress.total_reviews) * 100)
    : 0;

  const isRunning = progress.status === 'running';
  const isCompleted = progress.status === 'completed';
  const isFailed = progress.status === 'failed';
  const isCancelled = progress.status === 'cancelled';

  return (
    <Card className={cn(
      "border-2 transition-colors",
      isRunning && "border-primary/50 bg-primary/5",
      isCompleted && "border-green-500/50 bg-green-500/5",
      isFailed && "border-destructive/50 bg-destructive/5",
      isCancelled && "border-muted-foreground/50 bg-muted/50"
    )}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2">
              {isRunning && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="font-medium">Analyzing Disputes</span>
                </>
              )}
              {isCompleted && (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="font-medium text-green-600">Analysis Complete</span>
                </>
              )}
              {isFailed && (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="font-medium text-destructive">Analysis Failed</span>
                </>
              )}
              {isCancelled && (
                <>
                  <X className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-muted-foreground">Analysis Cancelled</span>
                </>
              )}
            </div>

            {/* Current guest */}
            {isRunning && progress.current_guest_name && (
              <p className="text-sm text-muted-foreground">
                Currently analyzing: <span className="font-medium text-foreground">{progress.current_guest_name}</span>
              </p>
            )}

            {/* Error message */}
            {isFailed && progress.error_message && (
              <p className="text-sm text-destructive">{progress.error_message}</p>
            )}

            {/* Progress bar */}
            <div className="space-y-1">
              <Progress value={percentComplete} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{percentComplete}%</span>
                <div className="flex items-center gap-3">
                  <span className="text-green-600">{progress.completed_reviews} completed</span>
                  {progress.skipped_reviews > 0 && (
                    <span className="text-amber-600">{progress.skipped_reviews} skipped</span>
                  )}
                  {progress.failed_reviews > 0 && (
                    <span className="text-destructive">{progress.failed_reviews} failed</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cancel button */}
          {isRunning && (
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
