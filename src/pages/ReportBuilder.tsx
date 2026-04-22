import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useUserRole } from '@/hooks/useUserRole';
import { Plus, Save, ArrowLeft, Eye } from 'lucide-react';
import { ModuleConfigForm } from '@/components/reports/ModuleConfigForm';
import { ModuleRenderer } from '@/components/reports/ModuleRenderer';
import type { ReportConfig, ReportModule } from '@/lib/reports/types';

function newModule(): ReportModule {
  return {
    id: crypto.randomUUID(),
    type: 'kpi',
    title: 'New module',
    metric: 'revenue',
    scope: { kind: 'all' },
    dateRange: { preset: 'ytd' },
    breakdown: 'month',
    compare: null,
  };
}

export default function ReportBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { organizationId } = useUserRole();

  const [name, setName] = useState('Untitled report');
  const [description, setDescription] = useState('');
  const [isTemplate, setIsTemplate] = useState(false);
  const [modules, setModules] = useState<ReportModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('custom_reports').select('*').eq('id', id).single();
      setLoading(false);
      if (error || !data) {
        toast({ title: 'Failed to load report', variant: 'destructive' });
        return;
      }
      const r = data as any;
      setName(r.name);
      setDescription(r.description ?? '');
      setIsTemplate(r.is_template);
      setModules(((r.config as ReportConfig)?.modules) ?? []);
    })();
  }, [id, toast]);

  const handleSave = async () => {
    if (!organizationId) {
      toast({ title: 'No organization', variant: 'destructive' });
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setSaving(true);
    const config: ReportConfig = { modules };
    const payload: any = {
      organization_id: organizationId,
      created_by: user.id,
      name,
      description: description || null,
      is_template: isTemplate,
      config,
    };

    if (id) {
      const { error } = await supabase
        .from('custom_reports')
        .update({ name, description: description || null, is_template: isTemplate, config: config as any })
        .eq('id', id);
      setSaving(false);
      if (error) {
        toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Saved' });
    } else {
      const { data, error } = await supabase
        .from('custom_reports')
        .insert(payload)
        .select()
        .single();
      setSaving(false);
      if (error) {
        toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
        return;
      }
      toast({ title: 'Created' });
      navigate(`/reports/${(data as any).id}/edit`, { replace: true });
    }
  };

  const updateModule = (idx: number, m: ReportModule) => {
    setModules((prev) => prev.map((x, i) => (i === idx ? m : x)));
  };

  const moveModule = (idx: number, dir: -1 | 1) => {
    setModules((prev) => {
      const copy = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= copy.length) return prev;
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="flex gap-2">
            {id && (
              <Button variant="outline" onClick={() => navigate(`/reports/${id}`)}>
                <Eye className="h-4 w-4 mr-2" /> View
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional notes for your team"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={isTemplate} onCheckedChange={(v) => setIsTemplate(!!v)} />
              Save as template (others can clone it as a starting point)
            </label>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Modules ({modules.length})</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setModules((prev) => [...prev, newModule()])}
              >
                <Plus className="h-4 w-4 mr-2" /> Add module
              </Button>
            </div>
            {modules.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No modules yet. Add one to start building your report.
              </p>
            )}
            {modules.map((m, idx) => (
              <ModuleConfigForm
                key={m.id}
                module={m}
                onChange={(nm) => updateModule(idx, nm)}
                onRemove={() => setModules((prev) => prev.filter((_, i) => i !== idx))}
                onMoveUp={idx > 0 ? () => moveModule(idx, -1) : undefined}
                onMoveDown={idx < modules.length - 1 ? () => moveModule(idx, 1) : undefined}
              />
            ))}
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-medium">Live preview</h2>
            {modules.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Add a module to see a preview.
                </CardContent>
              </Card>
            ) : (
              modules.map((m) => <ModuleRenderer key={m.id} module={m} />)
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
