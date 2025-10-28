import { useNavigate, useLocation } from "react-router-dom";
import { useCallback } from "react";

export interface NavigationState {
  dateRange?: any;
  filters?: any;
  searchQuery?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  scrollPosition?: number;
}

export interface NavigationReferrer {
  path: string;
  label: string;
  state?: NavigationState;
}

const REFERRER_STORAGE_KEY = "property_navigation_referrer";

export function useSmartNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateToProperty = useCallback((
    propertyId: string,
    referrerInfo: NavigationReferrer
  ) => {
    // Store in sessionStorage for persistence across refreshes
    sessionStorage.setItem(REFERRER_STORAGE_KEY, JSON.stringify(referrerInfo));

    // Navigate with state
    navigate(`/listings/${propertyId}`, {
      state: { referrer: referrerInfo }
    });
  }, [navigate]);

  const navigateBack = useCallback(() => {
    // Try to get referrer from location state first
    const stateReferrer = (location.state as any)?.referrer as NavigationReferrer | undefined;
    
    // Fall back to sessionStorage
    const storedReferrer = sessionStorage.getItem(REFERRER_STORAGE_KEY);
    const referrer = stateReferrer || (storedReferrer ? JSON.parse(storedReferrer) : null);

    if (referrer) {
      // Clear storage
      sessionStorage.removeItem(REFERRER_STORAGE_KEY);
      
      // Navigate to referrer with preserved state
      navigate(referrer.path, {
        state: referrer.state,
        replace: true
      });

      // Restore scroll position after navigation
      if (referrer.state?.scrollPosition) {
        setTimeout(() => {
          window.scrollTo(0, referrer.state!.scrollPosition);
        }, 50);
      }
    } else {
      // Fallback to browser history
      navigate(-1);
    }
  }, [navigate, location]);

  const getReferrer = useCallback((): NavigationReferrer | null => {
    const stateReferrer = (location.state as any)?.referrer as NavigationReferrer | undefined;
    if (stateReferrer) return stateReferrer;

    const storedReferrer = sessionStorage.getItem(REFERRER_STORAGE_KEY);
    return storedReferrer ? JSON.parse(storedReferrer) : null;
  }, [location]);

  return {
    navigateToProperty,
    navigateBack,
    getReferrer
  };
}
