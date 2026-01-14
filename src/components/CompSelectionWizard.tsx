import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Wand2, Copy, FileStack, ChevronRight, ChevronLeft, Search, CheckCircle2, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PropertyForSetup {
  id: string;
  nickname: string | null;
  bedrooms: number | null;
  city: string | null;
  cachedCount: number;
  selectedCount: number;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  airroi_listing_ids: string[];
}

interface CompSelectionWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: PropertyForSetup[];
  templates: Template[];
  propertiesWithComps: PropertyForSetup[];
}

type SelectionMethod = "ai" | "template" | "copy";

export function CompSelectionWizard({
  open,
  onOpenChange,
  properties,
  templates,
  propertiesWithComps,
}: CompSelectionWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(new Set());
  const [selectionMethod, setSelectionMethod] = useState<SelectionMethod>("ai");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [sourcePropertyId, setSourcePropertyId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [bedroomFilter, setBedroomFilter] = useState<string>("all");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState(0);
  const [executionResult, setExecutionResult] = useState<any>(null);

  // Get unique bedroom counts for filter
  const bedroomCounts = [...new Set(properties.map(p => p.bedrooms).filter(b => b !== null))].sort();
  const cities = [...new Set(properties.map(p => p.city).filter(c => c !== null))].sort();

  // Filter properties
  const filteredProperties = properties.filter(p => {
    const matchesSearch = p.nickname?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         p.city?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBedroom = bedroomFilter === "all" || p.bedrooms?.toString() === bedroomFilter;
    return matchesSearch && matchesBedroom;
  });

  // Toggle property selection
  const toggleProperty = (id: string) => {
    const newSet = new Set(selectedPropertyIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedPropertyIds(newSet);
  };

  // Select all filtered properties
  const selectAllFiltered = () => {
    const newSet = new Set(selectedPropertyIds);
    filteredProperties.forEach(p => newSet.add(p.id));
    setSelectedPropertyIds(newSet);
  };

  // Deselect all
  const deselectAll = () => {
    setSelectedPropertyIds(new Set());
  };

  // AI Selection mutation
  const aiSelectMutation = useMutation({
    mutationFn: async () => {
      const listingIds = Array.from(selectedPropertyIds);
      const { data, error } = await supabase.functions.invoke('batch-ai-select-comparables', {
        body: { listing_ids: listingIds, max_selections: 5 }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setExecutionResult(data);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ['all-comparables'] });
      queryClient.invalidateQueries({ queryKey: ['properties-for-comp-setup'] });
    },
    onError: (error) => {
      toast.error(`AI selection failed: ${error.message}`);
      setIsExecuting(false);
    }
  });

  // Template application mutation
  const applyTemplateMutation = useMutation({
    mutationFn: async () => {
      const listingIds = Array.from(selectedPropertyIds);
      const { data, error } = await supabase.functions.invoke('batch-apply-template', {
        body: { template_id: selectedTemplateId, listing_ids: listingIds }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setExecutionResult(data);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ['all-comparables'] });
      queryClient.invalidateQueries({ queryKey: ['properties-for-comp-setup'] });
    },
    onError: (error) => {
      toast.error(`Template application failed: ${error.message}`);
      setIsExecuting(false);
    }
  });

  // Copy compset mutation
  const copyCompsetMutation = useMutation({
    mutationFn: async () => {
      const targetIds = Array.from(selectedPropertyIds);
      const { data, error } = await supabase.functions.invoke('copy-compset', {
        body: { source_listing_id: sourcePropertyId, target_listing_ids: targetIds }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setExecutionResult(data);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ['all-comparables'] });
      queryClient.invalidateQueries({ queryKey: ['properties-for-comp-setup'] });
    },
    onError: (error) => {
      toast.error(`Copy compset failed: ${error.message}`);
      setIsExecuting(false);
    }
  });

  const executeAction = () => {
    setIsExecuting(true);
    switch (selectionMethod) {
      case "ai":
        aiSelectMutation.mutate();
        break;
      case "template":
        applyTemplateMutation.mutate();
        break;
      case "copy":
        copyCompsetMutation.mutate();
        break;
    }
  };

  const resetWizard = () => {
    setStep(1);
    setSelectedPropertyIds(new Set());
    setSelectionMethod("ai");
    setSelectedTemplateId("");
    setSourcePropertyId("");
    setSearchTerm("");
    setBedroomFilter("all");
    setIsExecuting(false);
    setExecutionProgress(0);
    setExecutionResult(null);
  };

  const handleClose = () => {
    resetWizard();
    onOpenChange(false);
  };

  const canProceedToStep2 = selectedPropertyIds.size > 0;
  const canProceedToStep3 = 
    (selectionMethod === "ai") ||
    (selectionMethod === "template" && selectedTemplateId) ||
    (selectionMethod === "copy" && sourcePropertyId);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const sourceProperty = propertiesWithComps.find(p => p.id === sourcePropertyId);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Quick Comp Selection Wizard</DialogTitle>
          <DialogDescription>
            Step {step} of 4 - {step === 1 ? "Select Properties" : step === 2 ? "Choose Method" : step === 3 ? "Review & Execute" : "Results"}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-4 py-2">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                s < step ? "bg-primary text-primary-foreground" :
                s === step ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {s < step ? <CheckCircle2 className="h-4 w-4" /> : s}
              </div>
              {s < 4 && <div className={`flex-1 h-1 ${s < step ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-auto">
          {/* Step 1: Select Properties */}
          {step === 1 && (
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search properties..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={bedroomFilter} onValueChange={setBedroomFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Bedrooms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Bedrooms</SelectItem>
                    {bedroomCounts.map(b => (
                      <SelectItem key={b} value={b?.toString() || "0"}>{b} BR</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {selectedPropertyIds.size} of {filteredProperties.length} selected
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAllFiltered}>
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll}>
                    Clear
                  </Button>
                </div>
              </div>

              <ScrollArea className="h-[300px] border rounded-md">
                <div className="p-2 space-y-1">
                  {filteredProperties.map((property) => (
                    <div
                      key={property.id}
                      className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${
                        selectedPropertyIds.has(property.id) ? "bg-muted" : ""
                      }`}
                      onClick={() => toggleProperty(property.id)}
                    >
                      <Checkbox 
                        checked={selectedPropertyIds.has(property.id)}
                        onCheckedChange={() => toggleProperty(property.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{property.nickname || property.id}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <span>{property.bedrooms} BR</span>
                          {property.city && <span>• {property.city}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {property.cachedCount} cached
                        </Badge>
                        {property.selectedCount > 0 ? (
                          <Badge variant="outline" className="text-xs">
                            {property.selectedCount} selected
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            None selected
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Step 2: Choose Method */}
          {step === 2 && (
            <div className="space-y-6 p-4">
              <RadioGroup value={selectionMethod} onValueChange={(v) => setSelectionMethod(v as SelectionMethod)}>
                <div className="space-y-4">
                  {/* AI Auto-Select */}
                  <div className={`flex items-start gap-4 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                    selectionMethod === "ai" ? "border-primary bg-muted/30" : ""
                  }`} onClick={() => setSelectionMethod("ai")}>
                    <RadioGroupItem value="ai" id="ai" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="ai" className="text-base font-medium flex items-center gap-2 cursor-pointer">
                        <Wand2 className="h-5 w-5 text-primary" />
                        AI Auto-Select
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Automatically select the top 5 comparables for each property based on bedroom match, 
                        location proximity (within 0.25-1 mile), and revenue similarity.
                      </p>
                    </div>
                  </div>

                  {/* Apply Template */}
                  <div className={`flex items-start gap-4 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                    selectionMethod === "template" ? "border-primary bg-muted/30" : ""
                  }`} onClick={() => setSelectionMethod("template")}>
                    <RadioGroupItem value="template" id="template" className="mt-1" />
                    <div className="flex-1 space-y-3">
                      <Label htmlFor="template" className="text-base font-medium flex items-center gap-2 cursor-pointer">
                        <FileStack className="h-5 w-5 text-primary" />
                        Apply Template
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Apply a saved compset template to all selected properties.
                      </p>
                      {selectionMethod === "template" && (
                        <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a template..." />
                          </SelectTrigger>
                          <SelectContent>
                            {templates.map(t => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name} ({t.airroi_listing_ids.length} comps)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  {/* Copy from Property */}
                  <div className={`flex items-start gap-4 p-4 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                    selectionMethod === "copy" ? "border-primary bg-muted/30" : ""
                  }`} onClick={() => setSelectionMethod("copy")}>
                    <RadioGroupItem value="copy" id="copy" className="mt-1" />
                    <div className="flex-1 space-y-3">
                      <Label htmlFor="copy" className="text-base font-medium flex items-center gap-2 cursor-pointer">
                        <Copy className="h-5 w-5 text-primary" />
                        Copy from Property
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Copy the selected comparables from another property.
                      </p>
                      {selectionMethod === "copy" && (
                        <Select value={sourcePropertyId} onValueChange={setSourcePropertyId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select source property..." />
                          </SelectTrigger>
                          <SelectContent>
                            {propertiesWithComps.filter(p => p.selectedCount > 0).map(p => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.nickname || p.id} ({p.selectedCount} comps, {p.bedrooms} BR)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Step 3: Review & Execute */}
          {step === 3 && (
            <div className="space-y-6 p-4">
              <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                <h3 className="font-medium">Review Your Selection</h3>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Properties:</span>
                    <span className="ml-2 font-medium">{selectedPropertyIds.size}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Method:</span>
                    <span className="ml-2 font-medium capitalize">
                      {selectionMethod === "ai" ? "AI Auto-Select" : 
                       selectionMethod === "template" ? "Apply Template" : "Copy from Property"}
                    </span>
                  </div>
                </div>

                {selectionMethod === "template" && selectedTemplate && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Template:</span>
                    <span className="ml-2 font-medium">{selectedTemplate.name} ({selectedTemplate.airroi_listing_ids.length} comps)</span>
                  </div>
                )}

                {selectionMethod === "copy" && sourceProperty && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Source:</span>
                    <span className="ml-2 font-medium">{sourceProperty.nickname} ({sourceProperty.selectedCount} comps)</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">Target Properties</h4>
                <ScrollArea className="h-[200px] border rounded-md">
                  <div className="p-2 space-y-1">
                    {Array.from(selectedPropertyIds).map(id => {
                      const property = properties.find(p => p.id === id);
                      if (!property) return null;
                      return (
                        <div key={id} className="flex items-center justify-between p-2 text-sm">
                          <span>{property.nickname || property.id}</span>
                          <span className="text-muted-foreground">{property.bedrooms} BR</span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {isExecuting && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Processing...</span>
                  </div>
                  <Progress value={executionProgress} className="h-2" />
                </div>
              )}
            </div>
          )}

          {/* Step 4: Results */}
          {step === 4 && (
            <div className="space-y-6 p-4">
              <div className="flex items-center gap-3 text-lg font-medium">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                <span>Complete!</span>
              </div>

              {executionResult && (
                <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {executionResult.summary && (
                      <>
                        <div>
                          <span className="text-muted-foreground">Properties Processed:</span>
                          <span className="ml-2 font-medium">{executionResult.summary.properties_processed}</span>
                        </div>
                        {executionResult.summary.total_selected !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Total Selected:</span>
                            <span className="ml-2 font-medium">{executionResult.summary.total_selected}</span>
                          </div>
                        )}
                        {executionResult.summary.total_applied !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Total Applied:</span>
                            <span className="ml-2 font-medium">{executionResult.summary.total_applied}</span>
                          </div>
                        )}
                        {executionResult.summary.total_copied !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Total Copied:</span>
                            <span className="ml-2 font-medium">{executionResult.summary.total_copied}</span>
                          </div>
                        )}
                        {executionResult.cache_reused !== undefined && (
                          <div>
                            <span className="text-muted-foreground">Cache Reused:</span>
                            <span className="ml-2 font-medium">{executionResult.cache_reused}</span>
                          </div>
                        )}
                        {executionResult.api_fetched !== undefined && (
                          <div>
                            <span className="text-muted-foreground">API Fetched:</span>
                            <span className="ml-2 font-medium">{executionResult.api_fetched}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {executionResult.results && executionResult.results.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-medium mb-2">Details</h4>
                      <ScrollArea className="h-[150px] border rounded-md">
                        <div className="p-2 space-y-1 text-sm">
                          {executionResult.results.map((r: any, idx: number) => {
                            const property = properties.find(p => p.id === r.listing_id);
                            return (
                              <div key={idx} className="flex items-center justify-between p-1">
                                <span>{property?.nickname || r.listing_id}</span>
                                <div className="flex items-center gap-2">
                                  {r.selected !== undefined && (
                                    <Badge variant="secondary">{r.selected} selected</Badge>
                                  )}
                                  {r.applied !== undefined && (
                                    <Badge variant="secondary">{r.applied} applied</Badge>
                                  )}
                                  {r.copied !== undefined && (
                                    <Badge variant="secondary">{r.copied} copied</Badge>
                                  )}
                                  {r.needs_fetch && (
                                    <Badge variant="destructive">Needs fetch</Badge>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with navigation */}
        <div className="flex items-center justify-between border-t pt-4 px-4 pb-2">
          <Button
            variant="outline"
            onClick={() => step === 1 ? handleClose() : setStep(step - 1)}
            disabled={isExecuting || step === 4}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step < 3 && (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 ? !canProceedToStep2 : !canProceedToStep3}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}

          {step === 3 && (
            <Button
              onClick={executeAction}
              disabled={isExecuting}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Execute
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          )}

          {step === 4 && (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
