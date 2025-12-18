import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, Loader2, RefreshCw, Copy, Check, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

interface CallPrepDialogProps {
  listingId: string;
  propertyName: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function CallPrepDialog({ listingId, propertyName }: CallPrepDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dataContext, setDataContext] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [followUpInput, setFollowUpInput] = useState("");
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const generateCallPrep = async () => {
    setLoading(true);
    setMessages([]);
    setDataContext(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-call-prep', {
        body: { listingId },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setMessages([{ role: "assistant", content: data.content }]);
      setDataContext(data.dataContext);
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

  const sendFollowUp = async () => {
    if (!followUpInput.trim() || !dataContext) return;

    const userMessage = followUpInput.trim();
    setFollowUpInput("");
    setSendingFollowUp(true);

    // Add user message immediately
    const newMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);

    try {
      // Build the messages array for the API
      // First message is always the data context, followed by the conversation
      const apiMessages: Message[] = [
        { role: "user", content: dataContext },
        ...newMessages
      ];

      const { data, error } = await supabase.functions.invoke('generate-call-prep', {
        body: { listingId, messages: apiMessages },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setMessages([...newMessages, { role: "assistant", content: data.content }]);
    } catch (error: any) {
      console.error('Error sending follow-up:', error);
      toast({
        title: "Failed to get response",
        description: error.message || "Please try again",
        variant: "destructive",
      });
      // Remove the user message if the request failed
      setMessages(messages);
    } finally {
      setSendingFollowUp(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && messages.length === 0 && !loading) {
      generateCallPrep();
    }
  };

  const handleCopy = async () => {
    const fullContent = messages
      .filter(m => m.role === "assistant")
      .map(m => m.content)
      .join("\n\n---\n\n");
    
    if (!fullContent) return;
    
    try {
      await navigator.clipboard.writeText(fullContent);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendFollowUp();
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
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
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
          <div className="flex flex-col items-center justify-center py-12 gap-4 flex-1">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Analyzing property data and generating talking points...</p>
          </div>
        ) : messages.length > 0 ? (
          <div className="flex flex-col flex-1 min-h-0 gap-4 overflow-hidden">
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
                  Restart
                </Button>
              </div>
            </div>
            
            <ScrollArea className="flex-1 min-h-0 pr-4" ref={scrollAreaRef}>
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`${
                      message.role === "user"
                        ? "bg-primary/10 ml-8 rounded-lg p-3"
                        : ""
                    }`}
                  >
                    {message.role === "user" ? (
                      <p className="text-sm font-medium">{message.content}</p>
                    ) : (
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
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
                {sendingFollowUp && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex gap-2 pt-2 border-t">
              <Input
                placeholder="Ask a follow-up question..."
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sendingFollowUp}
                className="flex-1"
              />
              <Button 
                onClick={sendFollowUp} 
                disabled={!followUpInput.trim() || sendingFollowUp}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-4 flex-1">
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
