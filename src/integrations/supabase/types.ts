export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      booking_curves: {
        Row: {
          created_at: string
          dba_bucket: string
          id: string
          listing_id: string
          pickup_amount_mean: number
          pickup_amount_stddev: number
          pickup_share: number
          sample_size: number
          updated_at: string
          year_month: string
        }
        Insert: {
          created_at?: string
          dba_bucket: string
          id?: string
          listing_id: string
          pickup_amount_mean?: number
          pickup_amount_stddev?: number
          pickup_share?: number
          sample_size?: number
          updated_at?: string
          year_month: string
        }
        Update: {
          created_at?: string
          dba_bucket?: string
          id?: string
          listing_id?: string
          pickup_amount_mean?: number
          pickup_amount_stddev?: number
          pickup_share?: number
          sample_size?: number
          updated_at?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_curves_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_calendar: {
        Row: {
          block_reason: string | null
          created_at: string
          date: string
          id: string
          is_available: boolean
          listing_id: string
          updated_at: string
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          date: string
          id?: string
          is_available?: boolean
          listing_id: string
          updated_at?: string
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          date?: string
          id?: string
          is_available?: boolean
          listing_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capacity_calendar_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_accuracy: {
        Row: {
          absolute_error: number | null
          actual_revenue: number | null
          created_at: string
          forecast_date: string
          forecast_p50: number
          id: string
          listing_id: string
          percentage_error: number | null
          target_month: string
        }
        Insert: {
          absolute_error?: number | null
          actual_revenue?: number | null
          created_at?: string
          forecast_date: string
          forecast_p50: number
          id?: string
          listing_id: string
          percentage_error?: number | null
          target_month: string
        }
        Update: {
          absolute_error?: number | null
          actual_revenue?: number | null
          created_at?: string
          forecast_date?: string
          forecast_p50?: number
          id?: string
          listing_id?: string
          percentage_error?: number | null
          target_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_accuracy_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_generation_progress: {
        Row: {
          completed_at: string | null
          completed_forecasts: number | null
          created_by: string | null
          error_message: string | null
          failed_forecasts: number | null
          id: string
          started_at: string | null
          status: string | null
          total_forecasts: number
        }
        Insert: {
          completed_at?: string | null
          completed_forecasts?: number | null
          created_by?: string | null
          error_message?: string | null
          failed_forecasts?: number | null
          id?: string
          started_at?: string | null
          status?: string | null
          total_forecasts: number
        }
        Update: {
          completed_at?: string | null
          completed_forecasts?: number | null
          created_by?: string | null
          error_message?: string | null
          failed_forecasts?: number | null
          id?: string
          started_at?: string | null
          status?: string | null
          total_forecasts?: number
        }
        Relationships: []
      }
      forecast_settings: {
        Row: {
          created_at: string
          dba_buckets: Json
          fallback_hierarchy: Json
          forecast_method: string
          id: string
          min_history_months: number
          organization_id: string | null
          owner_holds_treatment: string
          pace_clip_max: number
          pace_clip_min: number
          simulation_runs: number
          smoothing_window_months: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          dba_buckets?: Json
          fallback_hierarchy?: Json
          forecast_method?: string
          id?: string
          min_history_months?: number
          organization_id?: string | null
          owner_holds_treatment?: string
          pace_clip_max?: number
          pace_clip_min?: number
          simulation_runs?: number
          smoothing_window_months?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          dba_buckets?: Json
          fallback_hierarchy?: Json
          forecast_method?: string
          id?: string
          min_history_months?: number
          organization_id?: string | null
          owner_holds_treatment?: string
          pace_clip_max?: number
          pace_clip_min?: number
          simulation_runs?: number
          smoothing_window_months?: number
          updated_at?: string
        }
        Relationships: []
      }
      guesty_accounts: {
        Row: {
          account_name: string
          client_id: string
          client_secret: string
          created_at: string
          id: string
          last_listings_sync: string | null
          last_owners_sync: string | null
          last_reservations_sync: string | null
          last_reviews_sync: string | null
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          client_id: string
          client_secret: string
          created_at?: string
          id?: string
          last_listings_sync?: string | null
          last_owners_sync?: string | null
          last_reservations_sync?: string | null
          last_reviews_sync?: string | null
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          client_id?: string
          client_secret?: string
          created_at?: string
          id?: string
          last_listings_sync?: string | null
          last_owners_sync?: string | null
          last_reservations_sync?: string | null
          last_reviews_sync?: string | null
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guesty_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guesty_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          accommodates: number | null
          active: boolean | null
          address: Json | null
          archived: boolean
          bedrooms: number | null
          created_at_guesty: string | null
          guesty_account_id: string
          id: string
          imported_at: string
          is_listed: boolean | null
          nickname: string | null
          owner_id: string | null
          pictures: Json | null
          property_type: string | null
          status: string | null
          thumbnail: string | null
          updated_at: string
        }
        Insert: {
          accommodates?: number | null
          active?: boolean | null
          address?: Json | null
          archived?: boolean
          bedrooms?: number | null
          created_at_guesty?: string | null
          guesty_account_id: string
          id: string
          imported_at?: string
          is_listed?: boolean | null
          nickname?: string | null
          owner_id?: string | null
          pictures?: Json | null
          property_type?: string | null
          status?: string | null
          thumbnail?: string | null
          updated_at?: string
        }
        Update: {
          accommodates?: number | null
          active?: boolean | null
          address?: Json | null
          archived?: boolean
          bedrooms?: number | null
          created_at_guesty?: string | null
          guesty_account_id?: string
          id?: string
          imported_at?: string
          is_listed?: boolean | null
          nickname?: string | null
          owner_id?: string | null
          pictures?: Json | null
          property_type?: string | null
          status?: string | null
          thumbnail?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: false
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role?: Database["public"]["Enums"]["member_role"]
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      owner_groups: {
        Row: {
          created_at: string
          group_id: string
          id: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          owner_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "property_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_users: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          owner_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          owner_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_users_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owners: {
        Row: {
          email: string | null
          first_name: string | null
          full_name: string | null
          guesty_account_id: string
          id: string
          imported_at: string
          last_name: string | null
          listing_ids: Json | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          guesty_account_id: string
          id: string
          imported_at?: string
          last_name?: string | null
          listing_ids?: Json | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          guesty_account_id?: string
          id?: string
          imported_at?: string
          last_name?: string | null
          listing_ids?: Json | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owners_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: false
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      property_goals: {
        Row: {
          budget_revenue: number | null
          created_at: string
          goal_revenue: number | null
          id: string
          listing_id: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          month: number
          projection_revenue: number | null
          updated_at: string
          year: number
        }
        Insert: {
          budget_revenue?: number | null
          created_at?: string
          goal_revenue?: number | null
          id?: string
          listing_id: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          month: number
          projection_revenue?: number | null
          updated_at?: string
          year: number
        }
        Update: {
          budget_revenue?: number | null
          created_at?: string
          goal_revenue?: number | null
          id?: string
          listing_id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          month?: number
          projection_revenue?: number | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_goals_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      property_group_members: {
        Row: {
          created_at: string
          group_id: string
          id: string
          listing_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          listing_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "property_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_group_members_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      property_groups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          parent_group_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          parent_group_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_group_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_groups_parent_group_id_fkey"
            columns: ["parent_group_id"]
            isOneToOne: false
            referencedRelation: "property_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_nights: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          night_date: string
          reservation_id: string
          revenue_allocation: number
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          night_date: string
          reservation_id: string
          revenue_allocation?: number
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          night_date?: string
          reservation_id?: string
          revenue_allocation?: number
        }
        Relationships: [
          {
            foreignKeyName: "reservation_nights_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_nights_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          check_in: string | null
          check_out: string | null
          confirmation_code: string | null
          created_at_guesty: string | null
          fare_accommodation_adjusted: number | null
          guests_count: number | null
          guesty_account_id: string
          host_payout: number | null
          id: string
          imported_at: string
          last_updated_at_guesty: string | null
          listing_id: string
          nights_count: number | null
          owner_revenue: number | null
          source: string | null
          status: string | null
          total_paid: number | null
          updated_at: string
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          confirmation_code?: string | null
          created_at_guesty?: string | null
          fare_accommodation_adjusted?: number | null
          guests_count?: number | null
          guesty_account_id: string
          host_payout?: number | null
          id: string
          imported_at?: string
          last_updated_at_guesty?: string | null
          listing_id: string
          nights_count?: number | null
          owner_revenue?: number | null
          source?: string | null
          status?: string | null
          total_paid?: number | null
          updated_at?: string
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          confirmation_code?: string | null
          created_at_guesty?: string | null
          fare_accommodation_adjusted?: number | null
          guests_count?: number | null
          guesty_account_id?: string
          host_payout?: number | null
          id?: string
          imported_at?: string
          last_updated_at_guesty?: string | null
          listing_id?: string
          nights_count?: number | null
          owner_revenue?: number | null
          source?: string | null
          status?: string | null
          total_paid?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: false
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_forecasts: {
        Row: {
          backtest_metrics: Json | null
          capacity_utilization: number | null
          created_at: string
          dba_breakdown: Json | null
          forecast_method: string | null
          forecasted_revenue: Json
          generated_at: string
          goal_probabilities: Json
          goal_targets: Json | null
          id: string
          insights: Json
          listing_id: string
          monthly_forecasts: Json
          pace_factor: number | null
          revenue_on_books: number
          total_forecast: Json
          updated_at: string
          year: number
        }
        Insert: {
          backtest_metrics?: Json | null
          capacity_utilization?: number | null
          created_at?: string
          dba_breakdown?: Json | null
          forecast_method?: string | null
          forecasted_revenue: Json
          generated_at?: string
          goal_probabilities: Json
          goal_targets?: Json | null
          id?: string
          insights: Json
          listing_id: string
          monthly_forecasts: Json
          pace_factor?: number | null
          revenue_on_books: number
          total_forecast: Json
          updated_at?: string
          year: number
        }
        Update: {
          backtest_metrics?: Json | null
          capacity_utilization?: number | null
          created_at?: string
          dba_breakdown?: Json | null
          forecast_method?: string | null
          forecasted_revenue?: Json
          generated_at?: string
          goal_probabilities?: Json
          goal_targets?: Json | null
          id?: string
          insights?: Json
          listing_id?: string
          monthly_forecasts?: Json
          pace_factor?: number | null
          revenue_on_books?: number
          total_forecast?: Json
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      reviews: {
        Row: {
          category_ratings: Json | null
          guest_name: string | null
          guesty_account_id: string
          id: string
          imported_at: string
          is_removed: boolean
          listing_id: string
          rating: number | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          reservation_id: string | null
          response_text: string | null
          review_date: string | null
          review_text: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          category_ratings?: Json | null
          guest_name?: string | null
          guesty_account_id: string
          id: string
          imported_at?: string
          is_removed?: boolean
          listing_id: string
          rating?: number | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          reservation_id?: string | null
          response_text?: string | null
          review_date?: string | null
          review_text?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          category_ratings?: Json | null
          guest_name?: string | null
          guesty_account_id?: string
          id?: string
          imported_at?: string
          is_removed?: boolean
          listing_id?: string
          rating?: number | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          reservation_id?: string | null
          response_text?: string | null
          review_date?: string | null
          review_text?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: false
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_jobs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          guesty_account_id: string
          id: string
          items_synced: number | null
          last_synced_offset: number | null
          progress_message: string | null
          started_at: string
          status: string
          sync_type: string
          total_items: number | null
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          guesty_account_id: string
          id?: string
          items_synced?: number | null
          last_synced_offset?: number | null
          progress_message?: string | null
          started_at?: string
          status: string
          sync_type: string
          total_items?: number | null
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          guesty_account_id?: string
          id?: string
          items_synced?: number | null
          last_synced_offset?: number | null
          progress_message?: string | null
          started_at?: string
          status?: string
          sync_type?: string
          total_items?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: false
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_organization_invitation: {
        Args: { _token: string; _user_id: string }
        Returns: Json
      }
      cancel_sync_job: { Args: { job_id: string }; Returns: undefined }
      get_user_owner_id: { Args: { _user_id: string }; Returns: string }
      get_ytd_revenue_by_listing: {
        Args: { end_date: string; target_year: number }
        Returns: {
          listing_id: string
          total_revenue: number
        }[]
      }
      has_organization_role: {
        Args: {
          _organization_id: string
          _role: Database["public"]["Enums"]["member_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_group_owner: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_listing_in_owner_groups: {
        Args: { _listing_id: string; _owner_id: string }
        Returns: boolean
      }
      is_organization_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_owner_listing: {
        Args: { _listing_id: string; _owner_id: string }
        Returns: boolean
      }
      is_parent_group_owner: {
        Args: { _parent_group_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      member_role: "super_admin" | "admin" | "member" | "owner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      member_role: ["super_admin", "admin", "member", "owner"],
    },
  },
} as const
