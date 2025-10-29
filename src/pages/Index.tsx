import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Building2, BarChart3, TrendingUp, Users } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          // Check if user is an owner
          const { data: ownerUser } = await supabase
            .from('owner_users')
            .select('owner_id')
            .eq('user_id', session.user.id)
            .single();

          if (ownerUser) {
            // Redirect owner to their dashboard
            navigate(`/owners/${ownerUser.owner_id}`);
          } else {
            // Redirect other users to bulk edit
            navigate("/properties/bulk-edit");
          }
        }
      } finally {
        setChecking(false);
      }
    };

    checkAuthAndRedirect();
  }, [navigate]);

  if (checking) {
    return null; // Or a loading spinner
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-subtle)" }}>
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6" style={{ background: "var(--gradient-primary)" }}>
            <Building2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6">
            Property Revenue Manager
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            The all-in-one platform for vacation rental property managers to track revenue, analyze performance, and share insights with property owners.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" onClick={() => navigate("/auth")}>
              Get Started
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/auth")}>
              Sign In
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-8 mt-24 max-w-5xl mx-auto">
          <div className="text-center p-6 rounded-xl bg-card" style={{ boxShadow: "var(--shadow-soft)" }}>
            <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="w-6 h-6 text-accent" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Revenue Analytics</h3>
            <p className="text-muted-foreground">
              Track and visualize revenue trends across all your properties with beautiful charts and insights.
            </p>
          </div>

          <div className="text-center p-6 rounded-xl bg-card" style={{ boxShadow: "var(--shadow-soft)" }}>
            <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="w-6 h-6 text-accent" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Guesty Integration</h3>
            <p className="text-muted-foreground">
              Seamlessly sync your reservations and listings from Guesty for real-time data updates.
            </p>
          </div>

          <div className="text-center p-6 rounded-xl bg-card" style={{ boxShadow: "var(--shadow-soft)" }}>
            <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <Users className="w-6 h-6 text-accent" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Multi-Tenant</h3>
            <p className="text-muted-foreground">
              Built for property managers - each user gets their own secure workspace for managing properties.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
