import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Database, TrendingUp, Calendar, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ForecastAdmin() {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [forecastProgress, setForecastProgress] = useState<{
    progressId: string | null;
    total: number;
    completed: number;
    failed: number;
  }>({ progressId: null, total: 0, completed: 0, failed: 0 });

  // Poll for forecast generation progress
  useEffect(() => {
    if (!forecastProgress.progressId) return;

    const pollInterval = setInterval(async () => {
      const { data, error } = await supabase
        .from('forecast_generation_progress')
        .select('*')
        .eq('id', forecastProgress.progressId)
        .single();

      if (error) {
        console.error('Error polling progress:', error);
        return;
      }

      if (data) {
        setForecastProgress(prev => ({
          ...prev,
          completed: data.completed_forecasts,
          failed: data.failed_forecasts
        }));

        if (data.status === 'completed') {
          setStatus(prev => ({ ...prev, 'generate-all-forecasts': 'success' }));
          setLoading(prev => ({ ...prev, 'generate-all-forecasts': false }));
          setForecastProgress({ progressId: null, total: 0, completed: 0, failed: 0 });
          toast.success('All forecasts generated successfully', {
            description: `${data.completed_forecasts} forecasts completed, ${data.failed_forecasts} failed`
          });
          clearInterval(pollInterval);
        } else if (data.status === 'failed') {
          setStatus(prev => ({ ...prev, 'generate-all-forecasts': 'error' }));
          setLoading(prev => ({ ...prev, 'generate-all-forecasts': false }));
          setForecastProgress({ progressId: null, total: 0, completed: 0, failed: 0 });
          toast.error('Forecast generation failed', {
            description: data.error_message || 'An error occurred'
          });
          clearInterval(pollInterval);
        }
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [forecastProgress.progressId]);

  const runFunction = async (functionName: string, displayName: string) => {
    setLoading(prev => ({ ...prev, [functionName]: true }));
    setStatus(prev => ({ ...prev, [functionName]: 'running' }));

    try {
      const { data, error } = await supabase.functions.invoke(functionName);

      if (error) throw error;

      // Special handling for forecast generation
      if (functionName === 'generate-all-forecasts' && data?.progress_id) {
        setForecastProgress({
          progressId: data.progress_id,
          total: data.total_forecasts,
          completed: 0,
          failed: 0
        });
        toast.info('Forecast generation started', {
          description: `Processing ${data.total_properties} properties...`
        });
        return;
      }

      setStatus(prev => ({ ...prev, [functionName]: 'success' }));
      toast.success(`${displayName} completed successfully`, {
        description: data?.message || 'Operation completed'
      });
    } catch (error: any) {
      console.error(`Error running ${functionName}:`, error);
      setStatus(prev => ({ ...prev, [functionName]: 'error' }));
      toast.error(`${displayName} failed`, {
        description: error.message || 'An error occurred'
      });
    } finally {
      if (functionName !== 'generate-all-forecasts') {
        setLoading(prev => ({ ...prev, [functionName]: false }));
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="bg-green-500">Success</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'running':
        return <Badge variant="secondary">Running...</Badge>;
      default:
        return <Badge variant="outline">Not Run</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Forecast System Administration</h1>
          <p className="text-muted-foreground">
            Prepare data and regenerate forecasts using the RevPAR velocity model
          </p>
        </div>

        <Alert>
          <AlertDescription>
            <strong>First-time setup:</strong> Run step 1 to prepare reservation data, then step 2 to generate forecasts using the RevPAR velocity model.
          </AlertDescription>
        </Alert>

        <div className="grid gap-6">
          {/* Step 1: Explode Reservation Nights */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Database className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>1. Explode Reservation Nights</CardTitle>
                    <CardDescription>
                      Split historical reservations into per-night records for accurate revenue allocation
                    </CardDescription>
                  </div>
                </div>
                {status['explode-reservation-nights'] && getStatusBadge(status['explode-reservation-nights'])}
              </div>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => runFunction('explode-reservation-nights', 'Reservation Night Explosion')}
                disabled={loading['explode-reservation-nights']}
              >
                {loading['explode-reservation-nights'] && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Run Step 1
              </Button>
            </CardContent>
          </Card>

          {/* Step 2: Regenerate All Forecasts */}
          <Card className="border-2 border-primary">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <RefreshCw className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>2. Regenerate All Forecasts</CardTitle>
                    <CardDescription>
                      Use the RevPAR velocity model (Baseline × Velocity) to regenerate all property forecasts
                    </CardDescription>
                  </div>
                </div>
                {status['generate-all-forecasts'] && getStatusBadge(status['generate-all-forecasts'])}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() => runFunction('generate-all-forecasts', 'Forecast Regeneration')}
                disabled={loading['generate-all-forecasts']}
                size="lg"
              >
                {loading['generate-all-forecasts'] && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Regenerate All Forecasts
              </Button>
              
              {loading['generate-all-forecasts'] && forecastProgress.progressId && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Progress: {forecastProgress.completed} / {forecastProgress.total} forecasts
                    </span>
                    <span className="text-muted-foreground">
                      {Math.round((forecastProgress.completed / forecastProgress.total) * 100)}%
                    </span>
                  </div>
                  <Progress 
                    value={(forecastProgress.completed / forecastProgress.total) * 100} 
                    className="h-2"
                  />
                  {forecastProgress.failed > 0 && (
                    <p className="text-xs text-destructive">
                      {forecastProgress.failed} forecasts failed
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle>System Information</CardTitle>
            <CardDescription>Understanding the RevPAR velocity forecasting model</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">How It Works:</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li><strong>Baseline:</strong> Last year's actual monthly revenue for each month</li>
                <li><strong>Velocity Factor:</strong> Current RevPAR ÷ Last Year RevPAR (same-store comparison)</li>
                <li><strong>Forecast:</strong> Baseline × Velocity Factor (clipped between 0.5x - 2.0x)</li>
                <li><strong>Same-Store Logic:</strong> Compares bookings confirmed "as of today" vs "same day last year"</li>
                <li><strong>Monte Carlo Simulation:</strong> Applies ±20% noise to velocity for P10-P90 ranges</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Key Benefits:</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li>Intuitive: "Pacing 97% of last year" is instantly understandable</li>
                <li>Fair Comparison: Same booking window comparison for accurate trends</li>
                <li>Realistic: Uses actual historical performance as baseline</li>
                <li>No Complex Dependencies: No booking curves or capacity calendar required</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Maintenance:</h3>
              <p className="text-sm text-muted-foreground">
                Forecasts update dynamically as new bookings arrive. Re-run step 2 anytime to refresh all forecasts with the latest data.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
