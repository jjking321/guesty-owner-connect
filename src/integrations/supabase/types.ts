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
      ai_prompt_configs: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          prompt_key: string
          prompt_name: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          prompt_key: string
          prompt_name: string
          system_prompt: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          prompt_key?: string
          prompt_name?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_prompt_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      booking_probabilities: {
        Row: {
          avg_available_rate: number | null
          booking_window_score: number | null
          calculated_at: string | null
          compset_booked_count: number | null
          compset_demand_score: number | null
          compset_total_count: number | null
          created_at: string | null
          current_dba: number | null
          date: string
          expected_booking_window: number | null
          historical_date: string | null
          historical_dba: number | null
          historical_monthly_occupancy: number | null
          historical_rate: number | null
          historical_score: number | null
          historical_was_booked: boolean | null
          id: string
          is_dba_outlier: boolean | null
          listing_id: string
          price_position_score: number | null
          probability: number | null
          probability_mode: string | null
          updated_at: string | null
          weights_used: Json | null
          your_price: number | null
        }
        Insert: {
          avg_available_rate?: number | null
          booking_window_score?: number | null
          calculated_at?: string | null
          compset_booked_count?: number | null
          compset_demand_score?: number | null
          compset_total_count?: number | null
          created_at?: string | null
          current_dba?: number | null
          date: string
          expected_booking_window?: number | null
          historical_date?: string | null
          historical_dba?: number | null
          historical_monthly_occupancy?: number | null
          historical_rate?: number | null
          historical_score?: number | null
          historical_was_booked?: boolean | null
          id?: string
          is_dba_outlier?: boolean | null
          listing_id: string
          price_position_score?: number | null
          probability?: number | null
          probability_mode?: string | null
          updated_at?: string | null
          weights_used?: Json | null
          your_price?: number | null
        }
        Update: {
          avg_available_rate?: number | null
          booking_window_score?: number | null
          calculated_at?: string | null
          compset_booked_count?: number | null
          compset_demand_score?: number | null
          compset_total_count?: number | null
          created_at?: string | null
          current_dba?: number | null
          date?: string
          expected_booking_window?: number | null
          historical_date?: string | null
          historical_dba?: number | null
          historical_monthly_occupancy?: number | null
          historical_rate?: number | null
          historical_score?: number | null
          historical_was_booked?: boolean | null
          id?: string
          is_dba_outlier?: boolean | null
          listing_id?: string
          price_position_score?: number | null
          probability?: number | null
          probability_mode?: string | null
          updated_at?: string | null
          weights_used?: Json | null
          your_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_probabilities_listing_id_fkey"
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
          cta: boolean | null
          ctd: boolean | null
          currency: string | null
          date: string
          id: string
          is_available: boolean
          listing_id: string
          min_nights: number | null
          price: number | null
          status: string | null
          synced_from_guesty_at: string | null
          updated_at: string
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          cta?: boolean | null
          ctd?: boolean | null
          currency?: string | null
          date: string
          id?: string
          is_available?: boolean
          listing_id: string
          min_nights?: number | null
          price?: number | null
          status?: string | null
          synced_from_guesty_at?: string | null
          updated_at?: string
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          cta?: boolean | null
          ctd?: boolean | null
          currency?: string | null
          date?: string
          id?: string
          is_available?: boolean
          listing_id?: string
          min_nights?: number | null
          price?: number | null
          status?: string | null
          synced_from_guesty_at?: string | null
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
      composite_listing_children: {
        Row: {
          child_listing_id: string
          composite_listing_id: string
          created_at: string | null
          id: string
          revenue_share_weight: number | null
        }
        Insert: {
          child_listing_id: string
          composite_listing_id: string
          created_at?: string | null
          id?: string
          revenue_share_weight?: number | null
        }
        Update: {
          child_listing_id?: string
          composite_listing_id?: string
          created_at?: string | null
          id?: string
          revenue_share_weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "composite_listing_children_child_listing_id_fkey"
            columns: ["child_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "composite_listing_children_composite_listing_id_fkey"
            columns: ["composite_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      compset_templates: {
        Row: {
          airroi_listing_ids: string[]
          created_at: string
          created_by: string
          description: string | null
          guesty_account_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          airroi_listing_ids?: string[]
          created_at?: string
          created_by: string
          description?: string | null
          guesty_account_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          airroi_listing_ids?: string[]
          created_at?: string
          created_by?: string
          description?: string | null
          guesty_account_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compset_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compset_templates_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: false
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_reports: {
        Row: {
          config: Json
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_template: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_template?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_template?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dispute_analysis_progress: {
        Row: {
          completed_at: string | null
          completed_reviews: number
          created_by: string | null
          current_guest_name: string | null
          error_message: string | null
          failed_reviews: number
          id: string
          skipped_reviews: number
          started_at: string
          status: string
          total_reviews: number
        }
        Insert: {
          completed_at?: string | null
          completed_reviews?: number
          created_by?: string | null
          current_guest_name?: string | null
          error_message?: string | null
          failed_reviews?: number
          id?: string
          skipped_reviews?: number
          started_at?: string
          status?: string
          total_reviews?: number
        }
        Update: {
          completed_at?: string | null
          completed_reviews?: number
          created_by?: string | null
          current_guest_name?: string | null
          error_message?: string | null
          failed_reviews?: number
          id?: string
          skipped_reviews?: number
          started_at?: string
          status?: string
          total_reviews?: number
        }
        Relationships: []
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
      guesty_account_credentials: {
        Row: {
          client_id: string
          client_secret: string
          created_at: string
          guesty_account_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret: string
          created_at?: string
          guesty_account_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret?: string
          created_at?: string
          guesty_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guesty_account_credentials_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: true
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      guesty_accounts: {
        Row: {
          account_name: string
          actionables_generation_enabled: boolean | null
          airbnb_scrape_enabled: boolean | null
          automated_sync_enabled: boolean | null
          created_at: string
          dispute_analysis_enabled: boolean | null
          forecast_generation_enabled: boolean | null
          id: string
          last_automated_sync: string | null
          last_calendar_sync: string | null
          last_listings_sync: string | null
          last_owners_sync: string | null
          last_reservations_sync: string | null
          last_reviews_sync: string | null
          organization_id: string
          probability_calculation_enabled: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          actionables_generation_enabled?: boolean | null
          airbnb_scrape_enabled?: boolean | null
          automated_sync_enabled?: boolean | null
          created_at?: string
          dispute_analysis_enabled?: boolean | null
          forecast_generation_enabled?: boolean | null
          id?: string
          last_automated_sync?: string | null
          last_calendar_sync?: string | null
          last_listings_sync?: string | null
          last_owners_sync?: string | null
          last_reservations_sync?: string | null
          last_reviews_sync?: string | null
          organization_id: string
          probability_calculation_enabled?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          actionables_generation_enabled?: boolean | null
          airbnb_scrape_enabled?: boolean | null
          automated_sync_enabled?: boolean | null
          created_at?: string
          dispute_analysis_enabled?: boolean | null
          forecast_generation_enabled?: boolean | null
          id?: string
          last_automated_sync?: string | null
          last_calendar_sync?: string | null
          last_listings_sync?: string | null
          last_owners_sync?: string | null
          last_reservations_sync?: string | null
          last_reviews_sync?: string | null
          organization_id?: string
          probability_calculation_enabled?: boolean | null
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
      guesty_oauth_tokens: {
        Row: {
          access_token: string
          expires_at: string
          guesty_account_id: string
          oauth_cooldown_until: string | null
          refresh_in_progress: boolean
          refresh_started_at: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          guesty_account_id: string
          oauth_cooldown_until?: string | null
          refresh_in_progress?: boolean
          refresh_started_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          guesty_account_id?: string
          oauth_cooldown_until?: string | null
          refresh_in_progress?: boolean
          refresh_started_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guesty_oauth_tokens_guesty_account_id_fkey"
            columns: ["guesty_account_id"]
            isOneToOne: true
            referencedRelation: "guesty_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_activation_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          event_type: string
          id: string
          listing_id: string
          occurred_at: string
          organization_id: string
          raw: Json | null
          source: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          event_type: string
          id?: string
          listing_id: string
          occurred_at: string
          organization_id: string
          raw?: Json | null
          source?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          event_type?: string
          id?: string
          listing_id?: string
          occurred_at?: string
          organization_id?: string
          raw?: Json | null
          source?: string | null
        }
        Relationships: []
      }
      listing_booking_stats: {
        Row: {
          avg_booking_window: number | null
          calculated_at: string | null
          created_at: string | null
          id: string
          listing_id: string
          median_booking_window: number | null
          monthly_avg_windows: Json | null
          stddev_booking_window: number | null
          total_bookings_analyzed: number | null
          updated_at: string | null
        }
        Insert: {
          avg_booking_window?: number | null
          calculated_at?: string | null
          created_at?: string | null
          id?: string
          listing_id: string
          median_booking_window?: number | null
          monthly_avg_windows?: Json | null
          stddev_booking_window?: number | null
          total_bookings_analyzed?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_booking_window?: number | null
          calculated_at?: string | null
          created_at?: string | null
          id?: string
          listing_id?: string
          median_booking_window?: number | null
          monthly_avg_windows?: Json | null
          stddev_booking_window?: number | null
          total_bookings_analyzed?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_booking_stats_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_churn_events: {
        Row: {
          category: string | null
          churned_at: string
          created_at: string
          id: string
          ignored: boolean
          listing_id: string
          notes: string | null
          organization_id: string
          reason: string | null
          restored_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          churned_at?: string
          created_at?: string
          id?: string
          ignored?: boolean
          listing_id: string
          notes?: string | null
          organization_id: string
          reason?: string | null
          restored_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          churned_at?: string
          created_at?: string
          id?: string
          ignored?: boolean
          listing_id?: string
          notes?: string | null
          organization_id?: string
          reason?: string | null
          restored_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_churn_events_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_status_snapshots: {
        Row: {
          created_at: string
          organization_id: string
          snapshot_date: string
          total_active: number
          total_archived: number
          total_churned: number
          total_listed: number
        }
        Insert: {
          created_at?: string
          organization_id: string
          snapshot_date: string
          total_active?: number
          total_archived?: number
          total_churned?: number
          total_listed?: number
        }
        Update: {
          created_at?: string
          organization_id?: string
          snapshot_date?: string
          total_active?: number
          total_archived?: number
          total_churned?: number
          total_listed?: number
        }
        Relationships: []
      }
      listing_tax_settings: {
        Row: {
          behalf_platforms: string[] | null
          created_at: string | null
          excluded_from_tax: boolean
          id: string
          listing_id: string
          organization_id: string
          permit_number: string | null
          property_address: string | null
          tax_group_id: string | null
          updated_at: string | null
        }
        Insert: {
          behalf_platforms?: string[] | null
          created_at?: string | null
          excluded_from_tax?: boolean
          id?: string
          listing_id: string
          organization_id: string
          permit_number?: string | null
          property_address?: string | null
          tax_group_id?: string | null
          updated_at?: string | null
        }
        Update: {
          behalf_platforms?: string[] | null
          created_at?: string | null
          excluded_from_tax?: boolean
          id?: string
          listing_id?: string
          organization_id?: string
          permit_number?: string | null
          property_address?: string | null
          tax_group_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listing_tax_settings_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          accommodates: number | null
          active: boolean | null
          address: Json | null
          airbnb_listing_id: string | null
          archived: boolean
          bedrooms: number | null
          created_at_guesty: string | null
          guesty_account_id: string
          id: string
          imported_at: string
          is_composite: boolean | null
          is_listed: boolean | null
          last_active_at: string | null
          live_airbnb_rating: number | null
          live_airbnb_review_count: number | null
          live_rating_scrape_error: string | null
          live_rating_scraped_at: string | null
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
          airbnb_listing_id?: string | null
          archived?: boolean
          bedrooms?: number | null
          created_at_guesty?: string | null
          guesty_account_id: string
          id: string
          imported_at?: string
          is_composite?: boolean | null
          is_listed?: boolean | null
          last_active_at?: string | null
          live_airbnb_rating?: number | null
          live_airbnb_review_count?: number | null
          live_rating_scrape_error?: string | null
          live_rating_scraped_at?: string | null
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
          airbnb_listing_id?: string | null
          archived?: boolean
          bedrooms?: number | null
          created_at_guesty?: string | null
          guesty_account_id?: string
          id?: string
          imported_at?: string
          is_composite?: boolean | null
          is_listed?: boolean | null
          last_active_at?: string | null
          live_airbnb_rating?: number | null
          live_airbnb_review_count?: number | null
          live_rating_scrape_error?: string | null
          live_rating_scraped_at?: string | null
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
      nightly_sync_runs: {
        Row: {
          account_ids: string[]
          account_states: Json
          completed_at: string | null
          created_at: string
          current_step: string
          error_message: string | null
          id: string
          invocation_count: number
          retry_count: number | null
          retry_of: string | null
          started_at: string
          status: string
          step_results: Json
          updated_at: string
        }
        Insert: {
          account_ids?: string[]
          account_states?: Json
          completed_at?: string | null
          created_at?: string
          current_step?: string
          error_message?: string | null
          id?: string
          invocation_count?: number
          retry_count?: number | null
          retry_of?: string | null
          started_at?: string
          status?: string
          step_results?: Json
          updated_at?: string
        }
        Update: {
          account_ids?: string[]
          account_states?: Json
          completed_at?: string | null
          created_at?: string
          current_step?: string
          error_message?: string | null
          id?: string
          invocation_count?: number
          retry_count?: number | null
          retry_of?: string | null
          started_at?: string
          status?: string
          step_results?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nightly_sync_runs_retry_of_fkey"
            columns: ["retry_of"]
            isOneToOne: false
            referencedRelation: "nightly_sync_runs"
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
      organization_tax_settings: {
        Row: {
          behalf_platforms: string[] | null
          created_at: string | null
          id: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          behalf_platforms?: string[] | null
          created_at?: string | null
          id?: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          behalf_platforms?: string[] | null
          created_at?: string | null
          id?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: []
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
          active_organization_id: string | null
          company_name: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          active_organization_id?: string | null
          company_name?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          active_organization_id?: string | null
          company_name?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      property_actionables: {
        Row: {
          aggregate_score: number
          ai_summary: string | null
          created_at: string | null
          critical_count: number
          dismissed: boolean | null
          dismissed_at: string | null
          dismissed_by: string | null
          generated_at: string | null
          high_count: number
          id: string
          issues: Json
          listing_id: string | null
          low_count: number
          medium_count: number
          organization_id: string | null
          total_issue_count: number
          updated_at: string | null
        }
        Insert: {
          aggregate_score?: number
          ai_summary?: string | null
          created_at?: string | null
          critical_count?: number
          dismissed?: boolean | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          generated_at?: string | null
          high_count?: number
          id?: string
          issues?: Json
          listing_id?: string | null
          low_count?: number
          medium_count?: number
          organization_id?: string | null
          total_issue_count?: number
          updated_at?: string | null
        }
        Update: {
          aggregate_score?: number
          ai_summary?: string | null
          created_at?: string | null
          critical_count?: number
          dismissed?: boolean | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          generated_at?: string | null
          high_count?: number
          id?: string
          issues?: Json
          listing_id?: string | null
          low_count?: number
          medium_count?: number
          organization_id?: string | null
          total_issue_count?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_actionables_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_actionables_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_actionables_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_comparables: {
        Row: {
          airroi_listing_id: string
          booking_settings: Json | null
          cover_photo_url: string | null
          created_at: string | null
          fetched_at: string | null
          future_rates: Json | null
          future_rates_fetched_at: string | null
          historical_metrics: Json | null
          host_name: string | null
          id: string
          is_selected: boolean | null
          listing_id: string
          listing_name: string | null
          listing_type: string | null
          location_info: Json | null
          metrics_fetched_at: string | null
          performance_metrics: Json | null
          pricing_info: Json | null
          prior_ttm_adr: number | null
          prior_ttm_occupancy: number | null
          prior_ttm_revenue: number | null
          prior_ttm_revpar: number | null
          property_details: Json | null
          ratings: Json | null
          rollups_calculated_at: string | null
          room_type: string | null
          selected_at: string | null
          superhost: boolean | null
          ttm_adr: number | null
          ttm_occupancy: number | null
          ttm_revenue: number | null
          ttm_revpar: number | null
          updated_at: string | null
        }
        Insert: {
          airroi_listing_id: string
          booking_settings?: Json | null
          cover_photo_url?: string | null
          created_at?: string | null
          fetched_at?: string | null
          future_rates?: Json | null
          future_rates_fetched_at?: string | null
          historical_metrics?: Json | null
          host_name?: string | null
          id?: string
          is_selected?: boolean | null
          listing_id: string
          listing_name?: string | null
          listing_type?: string | null
          location_info?: Json | null
          metrics_fetched_at?: string | null
          performance_metrics?: Json | null
          pricing_info?: Json | null
          prior_ttm_adr?: number | null
          prior_ttm_occupancy?: number | null
          prior_ttm_revenue?: number | null
          prior_ttm_revpar?: number | null
          property_details?: Json | null
          ratings?: Json | null
          rollups_calculated_at?: string | null
          room_type?: string | null
          selected_at?: string | null
          superhost?: boolean | null
          ttm_adr?: number | null
          ttm_occupancy?: number | null
          ttm_revenue?: number | null
          ttm_revpar?: number | null
          updated_at?: string | null
        }
        Update: {
          airroi_listing_id?: string
          booking_settings?: Json | null
          cover_photo_url?: string | null
          created_at?: string | null
          fetched_at?: string | null
          future_rates?: Json | null
          future_rates_fetched_at?: string | null
          historical_metrics?: Json | null
          host_name?: string | null
          id?: string
          is_selected?: boolean | null
          listing_id?: string
          listing_name?: string | null
          listing_type?: string | null
          location_info?: Json | null
          metrics_fetched_at?: string | null
          performance_metrics?: Json | null
          pricing_info?: Json | null
          prior_ttm_adr?: number | null
          prior_ttm_occupancy?: number | null
          prior_ttm_revenue?: number | null
          prior_ttm_revpar?: number | null
          property_details?: Json | null
          ratings?: Json | null
          rollups_calculated_at?: string | null
          room_type?: string | null
          selected_at?: string | null
          superhost?: boolean | null
          ttm_adr?: number | null
          ttm_occupancy?: number | null
          ttm_revenue?: number | null
          ttm_revpar?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_comparables_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      property_compset_summary: {
        Row: {
          avg_prior_ttm_adr: number | null
          avg_prior_ttm_occupancy: number | null
          avg_prior_ttm_revenue: number | null
          avg_prior_ttm_revpar: number | null
          avg_ttm_adr: number | null
          avg_ttm_occupancy: number | null
          avg_ttm_revenue: number | null
          avg_ttm_revpar: number | null
          calculated_at: string | null
          created_at: string | null
          future_monthly_averages: Json | null
          id: string
          listing_id: string
          monthly_averages: Json | null
          selected_comparables_count: number | null
          updated_at: string | null
        }
        Insert: {
          avg_prior_ttm_adr?: number | null
          avg_prior_ttm_occupancy?: number | null
          avg_prior_ttm_revenue?: number | null
          avg_prior_ttm_revpar?: number | null
          avg_ttm_adr?: number | null
          avg_ttm_occupancy?: number | null
          avg_ttm_revenue?: number | null
          avg_ttm_revpar?: number | null
          calculated_at?: string | null
          created_at?: string | null
          future_monthly_averages?: Json | null
          id?: string
          listing_id: string
          monthly_averages?: Json | null
          selected_comparables_count?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_prior_ttm_adr?: number | null
          avg_prior_ttm_occupancy?: number | null
          avg_prior_ttm_revenue?: number | null
          avg_prior_ttm_revpar?: number | null
          avg_ttm_adr?: number | null
          avg_ttm_occupancy?: number | null
          avg_ttm_revenue?: number | null
          avg_ttm_revpar?: number | null
          calculated_at?: string | null
          created_at?: string | null
          future_monthly_averages?: Json | null
          id?: string
          listing_id?: string
          monthly_averages?: Json | null
          selected_comparables_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_compset_summary_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
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
          guest_name: string | null
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
          sub_total: number | null
          tax_amount: number | null
          total_paid: number | null
          updated_at: string
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          confirmation_code?: string | null
          created_at_guesty?: string | null
          fare_accommodation_adjusted?: number | null
          guest_name?: string | null
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
          sub_total?: number | null
          tax_amount?: number | null
          total_paid?: number | null
          updated_at?: string
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          confirmation_code?: string | null
          created_at_guesty?: string | null
          fare_accommodation_adjusted?: number | null
          guest_name?: string | null
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
          sub_total?: number | null
          tax_amount?: number | null
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
          avg_open_night_probability: number | null
          backtest_metrics: Json | null
          capacity_utilization: number | null
          compset_demand_index: number | null
          created_at: string
          dba_breakdown: Json | null
          forecast_confidence: string | null
          forecast_method: string | null
          forecasted_revenue: Json
          generated_at: string
          goal_probabilities: Json
          goal_targets: Json | null
          id: string
          insights: Json
          listing_id: string
          monthly_forecasts: Json
          monthly_forecasts_enhanced: Json | null
          pace_factor: number | null
          probability_weighted_revenue: number | null
          revenue_on_books: number
          total_forecast: Json
          updated_at: string
          year: number
        }
        Insert: {
          avg_open_night_probability?: number | null
          backtest_metrics?: Json | null
          capacity_utilization?: number | null
          compset_demand_index?: number | null
          created_at?: string
          dba_breakdown?: Json | null
          forecast_confidence?: string | null
          forecast_method?: string | null
          forecasted_revenue: Json
          generated_at?: string
          goal_probabilities: Json
          goal_targets?: Json | null
          id?: string
          insights: Json
          listing_id: string
          monthly_forecasts: Json
          monthly_forecasts_enhanced?: Json | null
          pace_factor?: number | null
          probability_weighted_revenue?: number | null
          revenue_on_books: number
          total_forecast: Json
          updated_at?: string
          year: number
        }
        Update: {
          avg_open_night_probability?: number | null
          backtest_metrics?: Json | null
          capacity_utilization?: number | null
          compset_demand_index?: number | null
          created_at?: string
          dba_breakdown?: Json | null
          forecast_confidence?: string | null
          forecast_method?: string | null
          forecasted_revenue?: Json
          generated_at?: string
          goal_probabilities?: Json
          goal_targets?: Json | null
          id?: string
          insights?: Json
          listing_id?: string
          monthly_forecasts?: Json
          monthly_forecasts_enhanced?: Json | null
          pace_factor?: number | null
          probability_weighted_revenue?: number | null
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
          dispute_analysis_context: string | null
          dispute_analyzed_at: string | null
          dispute_case_file: Json | null
          dispute_conversation_analyzed_at: string | null
          dispute_conversation_redflags: Json | null
          dispute_conversation_summary: string | null
          dispute_has_pressure: boolean | null
          dispute_has_refund_demands: boolean | null
          dispute_has_threats: boolean | null
          dispute_is_high_priority: boolean | null
          dispute_likelihood_score: number | null
          dispute_message_history: Json | null
          dispute_notes: string | null
          dispute_redflags_excluded: Json | null
          dispute_resolution: string | null
          dispute_resolved_at: string | null
          dispute_status: string | null
          dispute_submitted_at: string | null
          dispute_violation_category: string | null
          guest_name: string | null
          guesty_account_id: string
          id: string
          imported_at: string
          is_removed: boolean
          listing_id: string
          private_note: string | null
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
          dispute_analysis_context?: string | null
          dispute_analyzed_at?: string | null
          dispute_case_file?: Json | null
          dispute_conversation_analyzed_at?: string | null
          dispute_conversation_redflags?: Json | null
          dispute_conversation_summary?: string | null
          dispute_has_pressure?: boolean | null
          dispute_has_refund_demands?: boolean | null
          dispute_has_threats?: boolean | null
          dispute_is_high_priority?: boolean | null
          dispute_likelihood_score?: number | null
          dispute_message_history?: Json | null
          dispute_notes?: string | null
          dispute_redflags_excluded?: Json | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          dispute_status?: string | null
          dispute_submitted_at?: string | null
          dispute_violation_category?: string | null
          guest_name?: string | null
          guesty_account_id: string
          id: string
          imported_at?: string
          is_removed?: boolean
          listing_id: string
          private_note?: string | null
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
          dispute_analysis_context?: string | null
          dispute_analyzed_at?: string | null
          dispute_case_file?: Json | null
          dispute_conversation_analyzed_at?: string | null
          dispute_conversation_redflags?: Json | null
          dispute_conversation_summary?: string | null
          dispute_has_pressure?: boolean | null
          dispute_has_refund_demands?: boolean | null
          dispute_has_threats?: boolean | null
          dispute_is_high_priority?: boolean | null
          dispute_likelihood_score?: number | null
          dispute_message_history?: Json | null
          dispute_notes?: string | null
          dispute_redflags_excluded?: Json | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          dispute_status?: string | null
          dispute_submitted_at?: string | null
          dispute_violation_category?: string | null
          guest_name?: string | null
          guesty_account_id?: string
          id?: string
          imported_at?: string
          is_removed?: boolean
          listing_id?: string
          private_note?: string | null
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
      tax_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          permit_number: string | null
          property_address: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          permit_number?: string | null
          property_address?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          permit_number?: string | null
          property_address?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      get_accessible_organizations: {
        Args: never
        Returns: {
          id: string
          name: string
          role: Database["public"]["Enums"]["member_role"]
        }[]
      }
      get_composite_nights_for_listing: {
        Args: { p_end_date: string; p_listing_id: string; p_start_date: string }
        Returns: number
      }
      get_distributed_revenue: {
        Args: { p_end_date: string; p_listing_id: string; p_start_date: string }
        Returns: number
      }
      get_monthly_rating_trend: {
        Args: {
          p_end_date?: string
          p_listing_id?: string
          p_start_date?: string
        }
        Returns: {
          avg_rating: number
          month: string
          review_count: number
        }[]
      }
      get_portfolio_night_metrics: {
        Args: { p_month?: number; p_year: number }
        Returns: {
          actual_revenue: number
          future_nights: number
          listing_id: string
          otb_revenue: number
          past_nights: number
        }[]
      }
      get_review_summary_stats: {
        Args: {
          p_end_date?: string
          p_listing_id?: string
          p_start_date?: string
        }
        Returns: {
          avg_rating: number
          category_averages: Json
          platform_stats: Json
          rating_1_count: number
          rating_2_count: number
          rating_3_count: number
          rating_4_count: number
          rating_5_count: number
          total_reviews: number
        }[]
      }
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
      is_admin_for_group: {
        Args: { _group_id: string; _user_id: string }
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
      is_super_admin_anywhere: { Args: { _user_id: string }; Returns: boolean }
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
