import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Listings from "./pages/Listings";
import PropertyDetail from "./pages/PropertyDetail";
import Reservations from "./pages/Reservations";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import Groups from "./pages/Groups";
import GroupDetail from "./pages/GroupDetail";
import AcceptInvitation from "./pages/AcceptInvitation";
import PropertiesBulkEdit from "./pages/PropertiesBulkEdit";
import Owners from "./pages/Owners";
import OwnerDetail from "./pages/OwnerDetail";
import ForecastAdmin from "./pages/ForecastAdmin";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes default
      gcTime: 30 * 60 * 1000, // 30 minutes default (formerly cacheTime)
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/listings" element={<Listings />} />
          <Route path="/listings/:id" element={<PropertyDetail />} />
          <Route path="/properties/bulk-edit" element={<PropertiesBulkEdit />} />
          <Route path="/reservations" element={<Reservations />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupDetail />} />
          <Route path="/owners" element={<Owners />} />
          <Route path="/owners/:id" element={<OwnerDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/forecast-admin" element={<ForecastAdmin />} />
          <Route path="/accept-invitation" element={<AcceptInvitation />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
