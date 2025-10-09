import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Phone, Mail, RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Owner {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  property_count: number;
}

export default function Owners() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadOwners();
  }, []);

  const loadOwners = async () => {
    try {
      setLoading(true);
      
      // Fetch owners with listing count
      const { data: ownersData, error } = await supabase
        .from('owners')
        .select(`
          id,
          first_name,
          last_name,
          full_name,
          email,
          phone
        `)
        .order('full_name', { ascending: true, nullsFirst: false });

      if (error) throw error;

      // Get property counts separately
      const ownersWithCounts = await Promise.all(
        (ownersData || []).map(async (owner) => {
          const { count } = await supabase
            .from('listings')
            .select('*', { count: 'exact', head: true })
            .eq('owner_id', owner.id);

          return {
            ...owner,
            property_count: count || 0,
          };
        })
      );

      setOwners(ownersWithCounts);
    } catch (error: any) {
      toast({
        title: "Error loading owners",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredOwners = owners.filter(owner => {
    const query = searchQuery.toLowerCase();
    const fullName = owner.full_name?.toLowerCase() || '';
    const firstName = owner.first_name?.toLowerCase() || '';
    const lastName = owner.last_name?.toLowerCase() || '';
    const email = owner.email?.toLowerCase() || '';
    
    return fullName.includes(query) || 
           firstName.includes(query) || 
           lastName.includes(query) || 
           email.includes(query);
  });

  const getOwnerName = (owner: Owner) => {
    if (owner.full_name) return owner.full_name;
    if (owner.first_name && owner.last_name) return `${owner.first_name} ${owner.last_name}`;
    if (owner.first_name) return owner.first_name;
    if (owner.last_name) return owner.last_name;
    return 'Unknown Owner';
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Owners</h2>
          <p className="text-muted-foreground">Manage property owners and view their portfolios</p>
        </div>

        {/* Search & Actions */}
        <div className="flex gap-2">
          <Input
            placeholder="Search owners by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
          <Button onClick={loadOwners} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Owners Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredOwners.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {searchQuery ? (
                <>
                  <p>No owners found matching "{searchQuery}"</p>
                  <Button 
                    variant="link" 
                    onClick={() => setSearchQuery('')}
                    className="mt-2"
                  >
                    Clear search
                  </Button>
                </>
              ) : (
                <>
                  <p>No owners synced yet.</p>
                  <p className="text-sm mt-1">Sync owners from Settings to get started.</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredOwners.map((owner) => (
              <Card 
                key={owner.id}
                className="cursor-pointer hover:bg-accent transition-colors"
                onClick={() => navigate(`/owners/${owner.id}`)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{getOwnerName(owner)}</CardTitle>
                  {owner.email && (
                    <CardDescription className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {owner.email}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                      <span className="font-medium">{owner.property_count}</span>
                      <span>{owner.property_count === 1 ? 'Property' : 'Properties'}</span>
                    </div>
                    {owner.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        <span>{owner.phone}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}