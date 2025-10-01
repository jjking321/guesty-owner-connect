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
      guesty_accounts: {
        Row: {
          account_name: string
          client_id: string
          client_secret: string
          created_at: string
          id: string
          last_sync_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          client_id: string
          client_secret: string
          created_at?: string
          id?: string
          last_sync_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          client_id?: string
          client_secret?: string
          created_at?: string
          id?: string
          last_sync_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
          bedrooms: number | null
          created_at_guesty: string | null
          guesty_account_id: string
          id: string
          imported_at: string
          is_listed: boolean | null
          nickname: string | null
          property_type: string | null
          status: string | null
          thumbnail: string | null
          updated_at: string
        }
        Insert: {
          accommodates?: number | null
          active?: boolean | null
          address?: Json | null
          bedrooms?: number | null
          created_at_guesty?: string | null
          guesty_account_id: string
          id: string
          imported_at?: string
          is_listed?: boolean | null
          nickname?: string | null
          property_type?: string | null
          status?: string | null
          thumbnail?: string | null
          updated_at?: string
        }
        Update: {
          accommodates?: number | null
          active?: boolean | null
          address?: Json | null
          bedrooms?: number | null
          created_at_guesty?: string | null
          guesty_account_id?: string
          id?: string
          imported_at?: string
          is_listed?: boolean | null
          nickname?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
