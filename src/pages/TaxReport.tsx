import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaxSettingsTable } from "@/components/TaxSettingsTable";
import { TaxReportGenerator } from "@/components/TaxReportGenerator";
import { TaxExemptTable } from "@/components/TaxExemptTable";
import { TaxTemplateFill } from "@/components/TaxTemplateFill";
import { BackfillSubtotals } from "@/components/BackfillSubtotals";

export default function TaxReport() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tax Report</h1>
          <p className="text-muted-foreground">
            Generate tourism tax reports and CSV exports for filing.
          </p>
        </div>

        <BackfillSubtotals />

        <Tabs defaultValue="county" className="space-y-4">
          <TabsList>
            <TabsTrigger value="county">County</TabsTrigger>
            <TabsTrigger value="state">State</TabsTrigger>
            <TabsTrigger value="exempt">Tax Exempt</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="template">Template Fill</TabsTrigger>
          </TabsList>

          <TabsContent value="county">
            <TaxReportGenerator taxType="county" />
          </TabsContent>

          <TabsContent value="state">
            <TaxReportGenerator taxType="state" />
          </TabsContent>

          <TabsContent value="exempt">
            <TaxExemptTable />
          </TabsContent>

          <TabsContent value="settings">
            <TaxSettingsTable />
          </TabsContent>

          <TabsContent value="template">
            <TaxTemplateFill />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
