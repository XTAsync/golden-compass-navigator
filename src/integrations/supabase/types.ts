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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aml_flags: {
        Row: {
          amount: number | null
          created_at: string | null
          details: Json
          flag_reason: string | null
          id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          status: string | null
          transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          details?: Json
          flag_reason?: string | null
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          details?: Json
          flag_reason?: string | null
          id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aml_flags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
      brokerage_accounts: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_default: boolean
          label: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          user_id?: string
        }
        Relationships: []
      }
      fee_config: {
        Row: {
          commission_percent: number
          created_at: string
          currency: string
          id: string
          is_active: boolean
          label: string
          market: string
          min_commission: number
          tax_percent: number
          updated_at: string
        }
        Insert: {
          commission_percent?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          label?: string
          market: string
          min_commission?: number
          tax_percent?: number
          updated_at?: string
        }
        Update: {
          commission_percent?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          label?: string
          market?: string
          min_commission?: number
          tax_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      investment_pools: {
        Row: {
          created_at: string | null
          current_nav: number | null
          description: string | null
          exit_fee_percent: number | null
          holding_period_days: number | null
          id: string
          is_active: boolean | null
          min_investment: number | null
          name: string
          pool_type: string | null
          slug: string
          total_units: number | null
          total_value: number | null
        }
        Insert: {
          created_at?: string | null
          current_nav?: number | null
          description?: string | null
          exit_fee_percent?: number | null
          holding_period_days?: number | null
          id?: string
          is_active?: boolean | null
          min_investment?: number | null
          name: string
          pool_type?: string | null
          slug: string
          total_units?: number | null
          total_value?: number | null
        }
        Update: {
          created_at?: string | null
          current_nav?: number | null
          description?: string | null
          exit_fee_percent?: number | null
          holding_period_days?: number | null
          id?: string
          is_active?: boolean | null
          min_investment?: number | null
          name?: string
          pool_type?: string | null
          slug?: string
          total_units?: number | null
          total_value?: number | null
        }
        Relationships: []
      }
      kyc_records: {
        Row: {
          address: string | null
          annual_income_range: string | null
          country: string
          created_at: string | null
          date_of_birth: string | null
          document_type: string
          employment_status: string | null
          id: string
          national_id: string | null
          review_notes: string | null
          reviewed_by: string | null
          risk_disclosure_accepted: boolean | null
          source_of_funds: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          annual_income_range?: string | null
          country?: string
          created_at?: string | null
          date_of_birth?: string | null
          document_type?: string
          employment_status?: string | null
          id?: string
          national_id?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          risk_disclosure_accepted?: boolean | null
          source_of_funds?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          annual_income_range?: string | null
          country?: string
          created_at?: string | null
          date_of_birth?: string | null
          document_type?: string
          employment_status?: string | null
          id?: string
          national_id?: string | null
          review_notes?: string | null
          reviewed_by?: string | null
          risk_disclosure_accepted?: boolean | null
          source_of_funds?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          context: string
          created_at: string
          document_slug: string
          id: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          context?: string
          created_at?: string
          document_slug: string
          id?: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          context?: string
          created_at?: string
          document_slug?: string
          id?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      legal_documents: {
        Row: {
          created_at: string
          id: string
          is_draft: boolean
          published_at: string | null
          slug: string
          summary: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_draft?: boolean
          published_at?: string | null
          slug: string
          summary?: string | null
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          created_at?: string
          id?: string
          is_draft?: boolean
          published_at?: string | null
          slug?: string
          summary?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          account_id: string | null
          broker_order_id: string | null
          commission: number
          created_at: string
          currency: string
          error_message: string | null
          exchange: string
          filled_at: string | null
          id: string
          is_simulated: boolean
          price: number | null
          quantity: number
          side: string
          status: string
          symbol: string
          tax_withheld: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          broker_order_id?: string | null
          commission?: number
          created_at?: string
          currency?: string
          error_message?: string | null
          exchange?: string
          filled_at?: string | null
          id?: string
          is_simulated?: boolean
          price?: number | null
          quantity: number
          side: string
          status?: string
          symbol: string
          tax_withheld?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          broker_order_id?: string | null
          commission?: number
          created_at?: string
          currency?: string
          error_message?: string | null
          exchange?: string
          filled_at?: string | null
          id?: string
          is_simulated?: boolean
          price?: number | null
          quantity?: number
          side?: string
          status?: string
          symbol?: string
          tax_withheld?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pool_nav_history: {
        Row: {
          admin_notes: string | null
          id: string
          nav_value: number
          pool_id: string
          recorded_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          id?: string
          nav_value: number
          pool_id: string
          recorded_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          id?: string
          nav_value?: number
          pool_id?: string
          recorded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pool_nav_history_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "investment_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      price_alerts: {
        Row: {
          condition: string
          created_at: string
          exchange: string
          id: string
          name: string | null
          symbol: string
          threshold_price: number
          triggered_at: string | null
          user_id: string
        }
        Insert: {
          condition: string
          created_at?: string
          exchange?: string
          id?: string
          name?: string | null
          symbol: string
          threshold_price: number
          triggered_at?: string | null
          user_id: string
        }
        Update: {
          condition?: string
          created_at?: string
          exchange?: string
          id?: string
          name?: string | null
          symbol?: string
          threshold_price?: number
          triggered_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          currency: string
          enabled_markets: Json
          full_name: string
          id: string
          is_active: boolean | null
          kyc_status: string
          last_login: string | null
          phone: string | null
          updated_at: string
          wallet_balance: number
        }
        Insert: {
          created_at?: string
          currency?: string
          enabled_markets?: Json
          full_name?: string
          id: string
          is_active?: boolean | null
          kyc_status?: string
          last_login?: string | null
          phone?: string | null
          updated_at?: string
          wallet_balance?: number
        }
        Update: {
          created_at?: string
          currency?: string
          enabled_markets?: Json
          full_name?: string
          id?: string
          is_active?: boolean | null
          kyc_status?: string
          last_login?: string | null
          phone?: string | null
          updated_at?: string
          wallet_balance?: number
        }
        Relationships: []
      }
      stock_holdings: {
        Row: {
          avg_price: number
          created_at: string
          currency: string
          exchange: string
          id: string
          invested_amount: number
          quantity: number
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_price?: number
          created_at?: string
          currency?: string
          exchange?: string
          id?: string
          invested_amount?: number
          quantity?: number
          symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_price?: number
          created_at?: string
          currency?: string
          exchange?: string
          id?: string
          invested_amount?: number
          quantity?: number
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transaction_limits: {
        Row: {
          created_at: string
          currency: string
          daily_deposit_max: number
          daily_invest_max: number
          daily_withdrawal_max: number
          id: string
          is_active: boolean
          monthly_deposit_max: number
          monthly_withdrawal_max: number
          notes: string | null
          single_txn_max: number
          tier: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          daily_deposit_max?: number
          daily_invest_max?: number
          daily_withdrawal_max?: number
          id?: string
          is_active?: boolean
          monthly_deposit_max?: number
          monthly_withdrawal_max?: number
          notes?: string | null
          single_txn_max?: number
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          daily_deposit_max?: number
          daily_invest_max?: number
          daily_withdrawal_max?: number
          id?: string
          is_active?: boolean
          monthly_deposit_max?: number
          monthly_withdrawal_max?: number
          notes?: string | null
          single_txn_max?: number
          tier?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          confirmed_at: string | null
          created_at: string | null
          currency: string
          id: string
          mpesa_checkout_id: string | null
          mpesa_reference: string | null
          payout_phone: string | null
          pool_id: string | null
          status: string | null
          type: string | null
          user_id: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          created_at?: string | null
          currency?: string
          id?: string
          mpesa_checkout_id?: string | null
          mpesa_reference?: string | null
          payout_phone?: string | null
          pool_id?: string | null
          status?: string | null
          type?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string | null
          currency?: string
          id?: string
          mpesa_checkout_id?: string | null
          mpesa_reference?: string | null
          payout_phone?: string | null
          pool_id?: string | null
          status?: string | null
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "investment_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      user_investments: {
        Row: {
          created_at: string | null
          currency: string
          current_value: number | null
          id: string
          invested_amount: number | null
          pool_id: string
          units_owned: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          currency?: string
          current_value?: number | null
          id?: string
          invested_amount?: number | null
          pool_id: string
          units_owned?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          currency?: string
          current_value?: number | null
          id?: string
          invested_amount?: number | null
          pool_id?: string
          units_owned?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_investments_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "investment_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      watchlists: {
        Row: {
          added_at: string
          company: string | null
          exchange: string
          id: string
          symbol: string
          user_id: string
        }
        Insert: {
          added_at?: string
          company?: string | null
          exchange?: string
          id?: string
          symbol: string
          user_id: string
        }
        Update: {
          added_at?: string
          company?: string | null
          exchange?: string
          id?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      credit_wallet: {
        Args: { p_amount: number; p_user_id: string }
        Returns: number
      }
      debit_wallet: {
        Args: { p_amount: number; p_user_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "investor" | "admin" | "compliance" | "auditor"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["investor", "admin", "compliance", "auditor"],
    },
  },
} as const
