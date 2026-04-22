import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Plus, FileText, Copy, Trash2, Pencil, Eye } from 'lucide-react';
import { format } from 'date-fns';
import type { CustomReportRow } from '@/lib/reports/types';

export default function Reports() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['custom-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('custom_reports')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CustomReportRow[];
    },
  });

  const handleClone = async (r: CustomReportRow, asTemplate: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('custom_reports')
      .insert({
        organization_id: r.organization_id,
        created_by: user.id,
        name: `${r.name} (copy)`,
        description: r.description,
        is_template: asTemplate,
        config: r.config as any,
      })
      .select()
      .single();
    if (error) {
      toast({ title: 'Failed to clone', description: error.message, variant: 'destructive' });
      return;
    }
    qc.invalidateQueries({ queryKey: ['custom-reports'] });
    navigate(`/reports/${(data as any).id}/edit`);
  };

  const handleDelete = async (r: CustomReportRow) => {
    if (!confirm(`Delete "${r.name}"?`)) return;
    const { error } = await supabase.from('custom_reports').delete().eq('id', r.id);
    if (error) {
      toast({ title: 'Failed to delete', description: error.message, variant: 'destructive' });
      return;
    }
    qc.invalidateQueries({ queryKey: ['custom-reports'] });
    toast({ title: 'Deleted' });
  };

  const templates = reports.filter((r) => r.is_template);
  const saved = reports.filter((r) => !r.is_template);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
            <p className="text-sm text-muted-foreground">
              Build, save, and share custom reports with your team.
            </p>
          </div>
          <Button onClick={() => navigate('/reports/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New report
          </Button>
        </div>

        <Section
          title="Saved reports"
          empty="No saved reports yet. Click 'New report' to create one."
          items={saved}
          isLoading={isLoading}
          onClone={(r) => handleClone(r, false)}
          onDelete={handleDelete}
        />

        <Section
          title="Templates"
          empty="No templates yet. Save any report as a template to reuse it."
          items={templates}
          isLoading={isLoading}
          onClone={(r) => handleClone(r, false)}
          onDelete={handleDelete}
          isTemplate
        />
      </div>
    </DashboardLayout>
  );
}

interface SectionProps {
  title: string;
  empty: string;
  items: CustomReportRow[];
  isLoading: boolean;
  onClone: (r: CustomReportRow) => void;
  onDelete: (r: CustomReportRow) => void;
  isTemplate?: boolean;
}

function Section({ title, empty, items, isLoading, onClone, onDelete, isTemplate }: SectionProps) {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">{title}</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((r) => (
            <Card key={r.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0" />
                      {r.name}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Updated {format(new Date(r.updated_at), 'MMM d, yyyy')}
                    </CardDescription>
                  </div>
                  {isTemplate && <Badge variant="secondary">Template</Badge>}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between gap-3">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {r.description || `${r.config?.modules?.length ?? 0} module(s)`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {!isTemplate && (
                    <Button size="sm" variant="default" onClick={() => navigate(`/reports/${r.id}`)}>
                      <Eye className="h-4 w-4 mr-1" /> View
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      isTemplate ? onClone(r) : navigate(`/reports/${r.id}/edit`)
                    }
                  >
                    {isTemplate ? (
                      <><Copy className="h-4 w-4 mr-1" /> Use template</>
                    ) : (
                      <><Pencil className="h-4 w-4 mr-1" /> Edit</>
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(r)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
