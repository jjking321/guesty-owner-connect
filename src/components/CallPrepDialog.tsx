import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, Loader2, RefreshCw, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

interface CallPrepDialogProps {
  listingId: string;
  propertyName: string;
}

export function CallPrepDialog({ listingId, propertyName }: CallPrepDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const generateCallPrep = async () => {
    setLoading(true);
    setContent(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-call-prep', {
        body: { listingId },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setContent(data.content);
      setGeneratedAt(data.generatedAt);
    } catch (error: any) {
      console.error('Error generating call prep:', error);
      toast({
        title: "Failed to generate call prep",
        description: error.message || "Please try again later",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && !content && !loading) {
      generateCallPrep();
    }
  };

  const handleCopy = async () => {
    if (!content) return;
    
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast({
        title: "Copied to clipboard",
        description: "Call prep content has been copied",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please try selecting and copying manually",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Phone className="mr-2 h-4 w-4" />
          Call Prep
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Owner Call Prep
          </DialogTitle>
          <DialogDescription>
            AI-generated talking points for {propertyName}
          </DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Analyzing property data and generating talking points...</p>
          </div>
        ) : content ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Generated: {generatedAt ? new Date(generatedAt).toLocaleString() : 'Just now'}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={generateCallPrep}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[60vh] pr-4">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  components={{
                    h2: ({ children }) => (
                      <h2 className="text-lg font-semibold mt-6 mb-3 first:mt-0 text-foreground">{children}</h2>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc pl-5 space-y-1 my-2">{children}</ul>
                    ),
                    li: ({ children }) => (
                      <li className="text-foreground">{children}</li>
                    ),
                    p: ({ children }) => (
                      <p className="text-foreground my-2">{children}</p>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-foreground">{children}</strong>
                    ),
                  }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <p className="text-muted-foreground">Click the button below to generate call prep</p>
            <Button onClick={generateCallPrep}>
              <Phone className="mr-2 h-4 w-4" />
              Generate Call Prep
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
