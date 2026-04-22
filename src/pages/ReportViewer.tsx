import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Pencil, Download } from 'lucide-react';
import { ModuleRenderer } from '@/components/reports/ModuleRenderer';
import type { CustomReportRow, ReportConfig } from '@/lib/reports/types';
import { format } from 'date-fns';

export default function ReportViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [report, setReport] = useState<CustomReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      setReport(data as unknown as CustomReportRow);
    })();
  }, [id, toast]);

  const handleExportPdf = async () => {
    if (!containerRef.current || !report) return;
    setExporting(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 32;

      // Cover info
      pdf.setFontSize(20);
      pdf.text(report.name, margin, margin + 12);
      pdf.setFontSize(11);
      pdf.setTextColor(110);
      pdf.text(`Generated ${format(new Date(), 'MMM d, yyyy h:mm a')}`, margin, margin + 32);
      if (report.description) {
        pdf.text(report.description, margin, margin + 48, { maxWidth: pageWidth - margin * 2 });
      }
      pdf.setTextColor(0);

      let y = margin + 70;
      const moduleNodes = containerRef.current.querySelectorAll<HTMLElement>('[data-report-module]');

      for (const node of Array.from(moduleNodes)) {
        const canvas = await html2canvas(node, {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
        });
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = pageWidth - margin * 2;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        if (y + imgHeight > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
        pdf.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
        y += imgHeight + 16;
      }

      pdf.save(`${slugify(report.name)}.pdf`);
    } catch (e: any) {
      toast({ title: 'PDF export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Loading report…</p>
      </DashboardLayout>
    );
  }

  if (!report) {
    return (
      <DashboardLayout>
        <p className="text-sm text-muted-foreground">Report not found.</p>
      </DashboardLayout>
    );
  }

  const modules = (report.config as ReportConfig)?.modules ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/reports/${report.id}/edit`)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit
            </Button>
            <Button onClick={handleExportPdf} disabled={exporting}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? 'Exporting…' : 'Export PDF'}
            </Button>
          </div>
        </div>

        <div ref={containerRef} className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{report.name}</h1>
            {report.description && (
              <p className="text-sm text-muted-foreground mt-1">{report.description}</p>
            )}
          </div>

          {modules.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                This report has no modules yet. Click Edit to add some.
              </CardContent>
            </Card>
          ) : (
            modules.map((m) => <ModuleRenderer key={m.id} module={m} />)
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
}
