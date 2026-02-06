import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Star, 
  Loader2, 
  ExternalLink, 
  MessageSquare, 
  AlertTriangle,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  SprayCan,
  CheckCircle,
  KeyRound,
  MapPin,
  Tag,
  HelpCircle,
  Maximize2,
  Plus,
  X
} from "lucide-react";

const getCategoryIcon = (category: string) => {
  const iconMap: Record<string, React.FC<{ className?: string }>> = {
    'cleanliness': SprayCan,
    'accuracy': CheckCircle,
    'check-in': KeyRound,
    'checkin': KeyRound,
    'communication': MessageSquare,
    'location': MapPin,
    'value': Tag,
  };
  return iconMap[category.toLowerCase()] || HelpCircle;
};

const formatCategoryName = (key: string) => {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
};
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface RedFlag {
  category: "Extortion" | "Retaliatory" | "Third-Party" | "Irrelevant";
  severity: "high" | "medium" | "low";
  quote: string;
  context: string;
  sender: "guest" | "host";
  timestamp?: string;
}

interface ConversationRedFlags {
  redflags: RedFlag[];
  overallAssessment: string;
  evidenceStrength: "strong" | "moderate" | "weak" | "none";
}

interface DisputeReview {
  id: string;
  listing_id: string;
  guest_name: string | null;
  rating: number | null;
  review_date: string | null;
  review_text: string | null;
  source: string | null;
  category_ratings: Record<string, number> | null;
  dispute_status: string | null;
  dispute_resolution: string | null;
  dispute_likelihood_score: number | null;
  dispute_violation_category: string | null;
  dispute_case_file: any;
  dispute_analyzed_at: string | null;
  dispute_is_high_priority: boolean | null;
  dispute_message_history: any;
  dispute_conversation_summary: string | null;
  dispute_has_threats: boolean | null;
  dispute_has_pressure: boolean | null;
  dispute_has_refund_demands: boolean | null;
  dispute_notes: string | null;
  dispute_conversation_redflags?: ConversationRedFlags | null;
  dispute_conversation_analyzed_at?: string | null;
  dispute_analysis_context?: string | null;
  dispute_redflags_excluded?: number[] | null;
  property_name?: string;
  reservation_id?: string | null;
}

interface DisputeDetailSheetProps {
  review: DisputeReview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

export function DisputeDetailSheet({ review, open, onOpenChange, onUpdate }: DisputeDetailSheetProps) {
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingRedFlags, setAnalyzingRedFlags] = useState(false);
  const [fetchingConversation, setFetchingConversation] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editedCaseFile, setEditedCaseFile] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [conversationExpanded, setConversationExpanded] = useState(false);
  const [analysisContext, setAnalysisContext] = useState('');
  const [excludedFlags, setExcludedFlags] = useState<number[]>([]);
  const [showContextInput, setShowContextInput] = useState(false);

  // Initialize state when review changes
  useState(() => {
    if (review) {
      setEditedCaseFile(review.dispute_case_file);
      setNotes(review.dispute_notes || '');
      setAnalysisContext(review.dispute_analysis_context || '');
      setExcludedFlags(review.dispute_redflags_excluded || []);
    }
  });

  if (!review) return null;

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-review-dispute', {
        body: { reviewId: review.id, includeConversation: true },
      });

      if (error) throw error;

      toast({
        title: "Analysis complete",
        description: `Likelihood score: ${data.analysis?.likelihoodScore}%`,
      });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Analysis failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFetchConversation = async () => {
    setFetchingConversation(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-dispute-conversation', {
        body: { reviewId: review.id, reservationId: review.reservation_id },
      });

      if (error) throw error;

      toast({
        title: "Conversation fetched",
        description: `Found ${data.messages?.length || 0} messages`,
      });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Failed to fetch conversation",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setFetchingConversation(false);
    }
  };

  const handleAnalyzeRedFlags = async () => {
    setAnalyzingRedFlags(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-conversation-redflags', {
        body: { 
          reviewId: review.id,
          additionalContext: analysisContext || undefined,
          excludedFlagIndices: excludedFlags.length > 0 ? excludedFlags : undefined,
        },
      });

      if (error) throw error;

      // Reset excluded flags after re-analysis since indices may change
      setExcludedFlags([]);
      
      toast({
        title: "Red flag analysis complete",
        description: data.message || `Found ${data.analysis?.redflags?.length || 0} red flags`,
      });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Analysis failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAnalyzingRedFlags(false);
    }
  };

  const handleToggleExcludeFlag = (index: number) => {
    setExcludedFlags(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const handleSaveExclusions = async () => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('reviews')
        .update({ 
          dispute_redflags_excluded: excludedFlags,
          dispute_analysis_context: analysisContext,
          updated_at: new Date().toISOString(),
        })
        .eq('id', review.id);

      if (error) throw error;
      toast({ title: "Changes saved" });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    setUpdating(true);
    try {
      const updateData: any = { 
        dispute_status: newStatus,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === 'submitted') {
        updateData.dispute_submitted_at = new Date().toISOString();
      } else if (newStatus === 'resolved') {
        updateData.dispute_resolved_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('reviews')
        .update(updateData)
        .eq('id', review.id);

      if (error) throw error;

      toast({ title: "Status updated" });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdateResolution = async (resolution: string) => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('reviews')
        .update({ 
          dispute_resolution: resolution,
          dispute_resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', review.id);

      if (error) throw error;

      toast({ title: "Resolution saved" });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveNotes = async () => {
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('reviews')
        .update({ 
          dispute_notes: notes,
          dispute_case_file: editedCaseFile || review.dispute_case_file,
          updated_at: new Date().toISOString(),
        })
        .eq('id', review.id);

      if (error) throw error;

      toast({ title: "Changes saved" });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleCopyCase = () => {
    const caseFile = editedCaseFile || review.dispute_case_file;
    if (caseFile?.description) {
      navigator.clipboard.writeText(caseFile.description);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Case description copied" });
    }
  };

  const messages = review.dispute_message_history || [];
  const caseFile = editedCaseFile || review.dispute_case_file;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="truncate">{review.property_name || 'Unknown Property'}</span>
            {review.dispute_is_high_priority && (
              <Badge variant="destructive">High Priority</Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {review.guest_name || 'Unknown Guest'} • {review.review_date ? new Date(review.review_date).toLocaleDateString() : 'Unknown date'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] pr-4">
          <div className="space-y-6 py-4">
            {/* Review Header */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={cn(
                      "h-5 w-5",
                      star <= (review.rating || 0) 
                        ? "fill-yellow-400 text-yellow-400" 
                        : "text-muted-foreground"
                    )}
                  />
                ))}
              </div>
              <Badge variant="outline">{review.source || 'Unknown Platform'}</Badge>
            </div>

            {/* Review Text */}
            <div>
              <Label className="text-sm font-medium">Review Text</Label>
              <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                {review.review_text || 'No review text available'}
              </p>
            </div>

            {/* Category Ratings */}
            {review.category_ratings && Object.keys(review.category_ratings).length > 0 && (
              <div>
                <Label className="text-sm font-medium">Category Ratings</Label>
                <div className="mt-2 flex bg-muted/50 rounded-lg p-4">
                  {Object.entries(review.category_ratings).map(([key, value], index, array) => {
                    const IconComponent = getCategoryIcon(key);
                    return (
                      <div key={key} className="flex items-center">
                        <div className="flex flex-col items-center px-4 text-center">
                          <span className="text-sm font-medium text-foreground">
                            {formatCategoryName(key)}
                          </span>
                          <span className="text-sm text-muted-foreground mt-1">
                            {value}
                          </span>
                          <IconComponent className="h-5 w-5 mt-2 text-foreground" />
                        </div>
                        {index < array.length - 1 && (
                          <div className="h-16 w-px bg-border" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Separator />

            {/* AI Analysis Section */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  AI Dispute Analysis
                </Label>
                {!review.dispute_analyzed_at && (
                  <Button size="sm" onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Analyze
                  </Button>
                )}
                {review.dispute_analyzed_at && (
                  <Button size="sm" variant="outline" onClick={handleAnalyze} disabled={analyzing}>
                    {analyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Re-analyze
                  </Button>
                )}
              </div>

              {review.dispute_analyzed_at ? (
                <div className="space-y-4">
                  {/* Likelihood Score */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Removal Likelihood</span>
                      <span className="text-sm font-medium">
                        {review.dispute_likelihood_score}%
                      </span>
                    </div>
                    <Progress 
                      value={review.dispute_likelihood_score || 0} 
                      className="h-2"
                    />
                  </div>

                  {/* Violation Category */}
                  {review.dispute_violation_category && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Violation Category</Label>
                      <Badge className="mt-1">{review.dispute_violation_category}</Badge>
                    </div>
                  )}

                  {/* Conversation Flags */}
                  <div className="flex flex-wrap gap-2">
                    {review.dispute_has_threats && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Threats Detected
                      </Badge>
                    )}
                    {review.dispute_has_pressure && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Pressure/Coercion
                      </Badge>
                    )}
                    {review.dispute_has_refund_demands && (
                      <Badge variant="outline" className="gap-1">
                        Refund Demands
                      </Badge>
                    )}
                  </div>

                  {/* Conversation Summary */}
                  {review.dispute_conversation_summary && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Conversation Summary</Label>
                      <p className="mt-1 text-sm">
                        {review.dispute_conversation_summary}
                      </p>
                    </div>
                  )}

                  <span className="text-xs text-muted-foreground">
                    Analyzed: {new Date(review.dispute_analyzed_at).toLocaleString()}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click "Analyze" to have AI evaluate this review for dispute eligibility.
                </p>
              )}
            </div>

            <Separator />

            {/* Conversation History */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Conversation History ({messages.length} messages)
                </Label>
                <div className="flex gap-2">
                  {messages.length > 0 && (
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => setConversationExpanded(true)}
                    >
                      <Maximize2 className="h-4 w-4 mr-1" />
                      Expand
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={handleFetchConversation} 
                    disabled={fetchingConversation}
                  >
                    {fetchingConversation ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    {messages.length > 0 ? 'Refresh' : 'Fetch'}
                  </Button>
                </div>
              </div>

              {messages.length > 0 ? (
                <ScrollArea className="h-60 rounded-md border p-3">
                  <div className="space-y-3 pr-4">
                    {messages.map((msg: any, idx: number) => (
                      <div
                        key={idx}
                        className={cn(
                          "p-3 rounded-lg text-sm",
                          msg.sender === 'guest' 
                            ? "bg-muted ml-4" 
                            : "bg-primary/10 mr-4"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-xs">
                            {msg.sender === 'guest' ? 'Guest' : 'Host'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleDateString() : ''}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No conversation history available. Click "Fetch" to retrieve messages.
                </p>
              )}
            </div>

            {/* Expanded Conversation Dialog */}
            <Dialog open={conversationExpanded} onOpenChange={setConversationExpanded}>
              <DialogContent className="max-w-3xl max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    Conversation History - {review.guest_name || 'Guest'}
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className="h-[60vh] pr-4">
                  <div className="space-y-4">
                    {messages.map((msg: any, idx: number) => (
                      <div
                        key={idx}
                        className={cn(
                          "p-3 rounded-lg text-sm",
                          msg.sender === 'guest' 
                            ? "bg-muted ml-4" 
                            : "bg-primary/10 mr-4"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-xs">
                            {msg.sender === 'guest' ? 'Guest' : 'Host'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>

            {/* Conversation Red Flags Analysis */}
            {messages.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Conversation Red Flags
                    </Label>
                    <Button 
                      size="sm" 
                      variant={review.dispute_conversation_analyzed_at ? "outline" : "default"}
                      onClick={handleAnalyzeRedFlags} 
                      disabled={analyzingRedFlags}
                    >
                      {analyzingRedFlags ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : review.dispute_conversation_analyzed_at ? (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      {review.dispute_conversation_analyzed_at ? 'Re-analyze' : 'Analyze for Red Flags'}
                    </Button>
                  </div>

                  {/* Additional Context for Re-analysis */}
                  <div className="mb-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowContextInput(!showContextInput)}
                      className="text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {showContextInput ? 'Hide Context' : 'Add Context for Re-analysis'}
                    </Button>
                    
                    {showContextInput && (
                      <div className="mt-2 space-y-2">
                        <Textarea
                          value={analysisContext}
                          onChange={(e) => setAnalysisContext(e.target.value)}
                          placeholder="Add additional context the AI should consider (e.g., 'Guest was refunded after the stay', 'Host filed a damage claim before review')..."
                          rows={3}
                          className="text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          This context will be included when re-analyzing for red flags.
                        </p>
                      </div>
                    )}
                  </div>

                  {review.dispute_conversation_redflags ? (
                    <div className="space-y-4">
                      {/* Evidence Strength Badge */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Evidence Strength:</span>
                        <Badge 
                          variant={
                            review.dispute_conversation_redflags.evidenceStrength === 'strong' ? 'default' :
                            review.dispute_conversation_redflags.evidenceStrength === 'moderate' ? 'secondary' :
                            'outline'
                          }
                          className={cn(
                            review.dispute_conversation_redflags.evidenceStrength === 'strong' && "bg-green-600 hover:bg-green-600",
                            review.dispute_conversation_redflags.evidenceStrength === 'moderate' && "bg-amber-500 hover:bg-amber-500 text-white"
                          )}
                        >
                          {review.dispute_conversation_redflags.evidenceStrength?.toUpperCase()}
                        </Badge>
                      </div>

                      {/* Overall Assessment */}
                      <p className="text-sm bg-muted/50 p-3 rounded-lg">
                        {review.dispute_conversation_redflags.overallAssessment}
                      </p>

                      {/* Red Flag Cards */}
                      {review.dispute_conversation_redflags.redflags?.length > 0 ? (
                        <div className="space-y-3">
                          {review.dispute_conversation_redflags.redflags.map((flag: RedFlag, idx: number) => {
                            const isExcluded = excludedFlags.includes(idx);
                            return (
                              <div
                                key={idx}
                                className={cn(
                                  "p-3 rounded-lg border-l-4 relative",
                                  isExcluded && "opacity-50",
                                  flag.severity === 'high' && "border-l-destructive bg-destructive/10",
                                  flag.severity === 'medium' && "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20",
                                  flag.severity === 'low' && "border-l-yellow-400 bg-yellow-50 dark:bg-yellow-950/20"
                                )}
                              >
                                {/* Exclude toggle button - top right */}
                                <button
                                  onClick={() => handleToggleExcludeFlag(idx)}
                                  className={cn(
                                    "absolute top-2 right-2 p-1 rounded hover:bg-muted transition-colors",
                                    isExcluded ? "text-muted-foreground" : "text-destructive"
                                  )}
                                  title={isExcluded ? "Include this flag" : "Exclude this flag"}
                                >
                                  {isExcluded ? <Plus className="h-4 w-4" /> : <X className="h-4 w-4" />}
                                </button>
                                
                                {isExcluded && (
                                  <Badge variant="outline" className="absolute top-2 left-2 text-xs">
                                    Excluded
                                  </Badge>
                                )}

                                <div className={cn("flex items-center gap-2 mb-2", isExcluded && "mt-6")}>
                                  <Badge 
                                    variant={flag.severity === 'high' ? 'destructive' : 'secondary'}
                                    className={cn(
                                      flag.severity === 'medium' && "bg-amber-500 text-white hover:bg-amber-500",
                                      flag.severity === 'low' && "bg-yellow-400 text-black hover:bg-yellow-400"
                                    )}
                                  >
                                    {flag.category}
                                  </Badge>
                                  <span className={cn(
                                    "text-xs font-medium px-2 py-0.5 rounded",
                                    flag.severity === 'high' && "bg-destructive/20 text-destructive",
                                    flag.severity === 'medium' && "bg-amber-500/20 text-amber-700 dark:text-amber-400",
                                    flag.severity === 'low' && "bg-yellow-400/20 text-yellow-700 dark:text-yellow-400"
                                  )}>
                                    {flag.severity.toUpperCase()}
                                  </span>
                                </div>
                                
                                <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-sm text-muted-foreground mb-2">
                                  "{flag.quote}"
                                </blockquote>
                                
                                <p className="text-sm">{flag.context}</p>
                                
                                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                  <span className="font-medium">{flag.sender === 'guest' ? 'Guest' : 'Host'}</span>
                                  {flag.timestamp && (
                                    <>
                                      <span>•</span>
                                      <span>{flag.timestamp}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {/* Save Exclusions Button */}
                          {excludedFlags.length > 0 && (
                            <div className="flex items-center justify-between pt-2 border-t">
                              <span className="text-sm text-muted-foreground">
                                {excludedFlags.length} flag{excludedFlags.length > 1 ? 's' : ''} excluded
                              </span>
                              <Button size="sm" variant="outline" onClick={handleSaveExclusions} disabled={updating}>
                                {updating && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                                Save Exclusions
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No policy violations detected in the conversation.
                        </p>
                      )}

                      <span className="text-xs text-muted-foreground">
                        Analyzed: {new Date(review.dispute_conversation_analyzed_at!).toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Click "Analyze for Red Flags" to scan the conversation for policy violations that could support your dispute.
                    </p>
                  )}
                </div>
              </>
            )}

            <Separator />

            {/* Case File */}
            {caseFile && (
              <div>
                <Label className="text-sm font-medium">Dispute Case File</Label>
                
                <div className="mt-2 space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Category Reason</Label>
                    <Textarea
                      value={caseFile.category_reason || ''}
                      onChange={(e) => setEditedCaseFile({ ...caseFile, category_reason: e.target.value })}
                      className="mt-1"
                      rows={2}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Dispute Description</Label>
                      <Button size="sm" variant="ghost" onClick={handleCopyCase}>
                        {copied ? (
                          <Check className="h-4 w-4 mr-1" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1" />
                        )}
                        Copy
                      </Button>
                    </div>
                    <Textarea
                      value={caseFile.description || ''}
                      onChange={(e) => setEditedCaseFile({ ...caseFile, description: e.target.value })}
                      className="mt-1"
                      rows={6}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <Label className="text-sm font-medium">Internal Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this dispute..."
                className="mt-2"
                rows={3}
              />
            </div>

            <Button onClick={handleSaveNotes} disabled={updating} className="w-full">
              {updating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>

            <Separator />

            {/* Actions */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Actions</Label>

              {/* Airbnb Link */}
              <Button 
                variant="outline" 
                className="w-full justify-start"
                asChild
              >
                <a 
                  href="https://www.airbnb.com/resolution/review_dispute/intro?_entry=macro" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Airbnb Dispute Form
                </a>
              </Button>

              {/* Status Update */}
              {review.dispute_status !== 'resolved' && (
                <div className="flex gap-2">
                  {review.dispute_status === 'submit_claim' && (
                    <Button 
                      variant="default"
                      onClick={() => handleUpdateStatus('submitted')}
                      disabled={updating}
                      className="flex-1"
                    >
                      Mark as Submitted
                    </Button>
                  )}
                  {review.dispute_status === 'submitted' && (
                    <Button 
                      variant="default"
                      onClick={() => handleUpdateStatus('pending')}
                      disabled={updating}
                      className="flex-1"
                    >
                      Move to Pending
                    </Button>
                  )}
                  {(review.dispute_status === 'pending' || review.dispute_status === 'submitted') && (
                    <Button 
                      variant="secondary"
                      onClick={() => handleUpdateStatus('resolved')}
                      disabled={updating}
                      className="flex-1"
                    >
                      Mark Resolved
                    </Button>
                  )}
                </div>
              )}

              {/* Resolution */}
              {review.dispute_status === 'resolved' && (
                <div>
                  <Label className="text-xs text-muted-foreground">Resolution Outcome</Label>
                  <Select 
                    value={review.dispute_resolution || ''} 
                    onValueChange={handleUpdateResolution}
                    disabled={updating}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select outcome" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="removed">Review Removed</SelectItem>
                      <SelectItem value="denied">Dispute Denied</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Move to different column */}
              {review.dispute_status !== 'analyzing' && (
                <div>
                  <Label className="text-xs text-muted-foreground">Move to Stage</Label>
                  <Select 
                    value={review.dispute_status || ''} 
                    onValueChange={handleUpdateStatus}
                    disabled={updating}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="triage">Triage</SelectItem>
                      <SelectItem value="not_eligible">Not Eligible</SelectItem>
                      <SelectItem value="submit_claim">Submit Claim</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
