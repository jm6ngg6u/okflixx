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
      access_key_redemptions: {
        Row: {
          activation_code: string | null
          code_prefix: string | null
          created_at: string
          fingerprint_hash: string | null
          id: string
          ip_hash: string | null
          key_id: string | null
          reason: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          activation_code?: string | null
          code_prefix?: string | null
          created_at?: string
          fingerprint_hash?: string | null
          id?: string
          ip_hash?: string | null
          key_id?: string | null
          reason?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          activation_code?: string | null
          code_prefix?: string | null
          created_at?: string
          fingerprint_hash?: string | null
          id?: string
          ip_hash?: string | null
          key_id?: string | null
          reason?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_key_redemptions_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "access_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      access_keys: {
        Row: {
          code_hash: string
          code_prefix: string
          created_at: string
          created_by: string | null
          disabled: boolean
          expires_at: string | null
          first_redeemed_at: string | null
          id: string
          key_type: string
          label: string | null
          last_used_at: string | null
          max_uses: number | null
          notes: string | null
          redeemer_fingerprint_hash: string | null
          redeemer_ip_hash: string | null
          updated_at: string
          uses_count: number
        }
        Insert: {
          code_hash: string
          code_prefix: string
          created_at?: string
          created_by?: string | null
          disabled?: boolean
          expires_at?: string | null
          first_redeemed_at?: string | null
          id?: string
          key_type: string
          label?: string | null
          last_used_at?: string | null
          max_uses?: number | null
          notes?: string | null
          redeemer_fingerprint_hash?: string | null
          redeemer_ip_hash?: string | null
          updated_at?: string
          uses_count?: number
        }
        Update: {
          code_hash?: string
          code_prefix?: string
          created_at?: string
          created_by?: string | null
          disabled?: boolean
          expires_at?: string | null
          first_redeemed_at?: string | null
          id?: string
          key_type?: string
          label?: string | null
          last_used_at?: string | null
          max_uses?: number | null
          notes?: string | null
          redeemer_fingerprint_hash?: string | null
          redeemer_ip_hash?: string | null
          updated_at?: string
          uses_count?: number
        }
        Relationships: []
      }
      access_sessions: {
        Row: {
          created_at: string
          expires_at: string
          fingerprint_hash: string | null
          id: string
          ip_hash: string | null
          key_id: string | null
          session_token_hash: string
          uses_count: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          fingerprint_hash?: string | null
          id?: string
          ip_hash?: string | null
          key_id?: string | null
          session_token_hash: string
          uses_count?: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          fingerprint_hash?: string | null
          id?: string
          ip_hash?: string | null
          key_id?: string | null
          session_token_hash?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_sessions_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "access_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      activation_attempts: {
        Row: {
          attempt_number: number
          code: string
          cookie_id: string | null
          country: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          ip_hash: string | null
          proxy_id: string | null
          proxy_mode: boolean
          result: string
          selection_reason: Json | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          attempt_number?: number
          code: string
          cookie_id?: string | null
          country?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_hash?: string | null
          proxy_id?: string | null
          proxy_mode?: boolean
          result: string
          selection_reason?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          attempt_number?: number
          code?: string
          cookie_id?: string | null
          country?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_hash?: string | null
          proxy_id?: string | null
          proxy_mode?: boolean
          result?: string
          selection_reason?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activation_attempts_cookie_id_fkey"
            columns: ["cookie_id"]
            isOneToOne: false
            referencedRelation: "cookie_pool"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activation_attempts_proxy_id_fkey"
            columns: ["proxy_id"]
            isOneToOne: false
            referencedRelation: "proxy_pool"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_activity_log: {
        Row: {
          action: string
          actor_label: string | null
          admin_id: string | null
          created_at: string
          details: Json | null
          id: string
          target: string | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          admin_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          admin_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target?: string | null
        }
        Relationships: []
      }
      admin_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      admin_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          used_ip_hash: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          used_ip_hash?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          used_ip_hash?: string | null
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      auth_audit_log: {
        Row: {
          created_at: string
          email: string | null
          event: string
          id: string
          ip_hash: string | null
          metadata: Json
          reason: string | null
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          event: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          reason?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          event?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          reason?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      background_song_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          session_hash: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          session_hash?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          session_hash?: string | null
        }
        Relationships: []
      }
      background_song_history: {
        Row: {
          id: string
          is_current: boolean
          name: string
          path: string
          size_bytes: number
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          is_current?: boolean
          name: string
          path: string
          size_bytes?: number
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          is_current?: boolean
          name?: string
          path?: string
          size_bytes?: number
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      branding_history: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      branding_presets: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          audience: string
          body_md: string
          created_at: string
          created_by: string | null
          id: string
          last_error: string | null
          scheduled_at: string | null
          sent_at: string | null
          sent_count: number
          status: string
          subject: string
        }
        Insert: {
          audience?: string
          body_md: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject: string
        }
        Update: {
          audience?: string
          body_md?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_error?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject?: string
        }
        Relationships: []
      }
      cookie_pool: {
        Row: {
          cookies_json: Json
          country: string | null
          created_at: string
          email: string | null
          fail_count: number
          fingerprint: string
          id: string
          is_locked: boolean
          is_valid: boolean
          label: string | null
          last_checked_at: string | null
          last_checked_mode: string | null
          last_error: string | null
          last_used_at: string | null
          locked_at: string | null
          max_streams: number | null
          member_since: string | null
          name: string | null
          payment_method: string | null
          plan_name: string | null
          status: string
          success_count: number
          total_uses: number
          uploaded_by: string | null
          video_quality: string | null
        }
        Insert: {
          cookies_json: Json
          country?: string | null
          created_at?: string
          email?: string | null
          fail_count?: number
          fingerprint: string
          id?: string
          is_locked?: boolean
          is_valid?: boolean
          label?: string | null
          last_checked_at?: string | null
          last_checked_mode?: string | null
          last_error?: string | null
          last_used_at?: string | null
          locked_at?: string | null
          max_streams?: number | null
          member_since?: string | null
          name?: string | null
          payment_method?: string | null
          plan_name?: string | null
          status?: string
          success_count?: number
          total_uses?: number
          uploaded_by?: string | null
          video_quality?: string | null
        }
        Update: {
          cookies_json?: Json
          country?: string | null
          created_at?: string
          email?: string | null
          fail_count?: number
          fingerprint?: string
          id?: string
          is_locked?: boolean
          is_valid?: boolean
          label?: string | null
          last_checked_at?: string | null
          last_checked_mode?: string | null
          last_error?: string | null
          last_used_at?: string | null
          locked_at?: string | null
          max_streams?: number | null
          member_since?: string | null
          name?: string | null
          payment_method?: string | null
          plan_name?: string | null
          status?: string
          success_count?: number
          total_uses?: number
          uploaded_by?: string | null
          video_quality?: string | null
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          control: string | null
          error: string | null
          finished_at: string | null
          id: string
          job: string
          ok: boolean | null
          progress: Json | null
          started_at: string
          summary: Json | null
        }
        Insert: {
          control?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job: string
          ok?: boolean | null
          progress?: Json | null
          started_at?: string
          summary?: Json | null
        }
        Update: {
          control?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job?: string
          ok?: boolean | null
          progress?: Json | null
          started_at?: string
          summary?: Json | null
        }
        Relationships: []
      }
      otp_attempts: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_hash: string | null
          kind: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_hash?: string | null
          kind?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_hash?: string | null
          kind?: string
        }
        Relationships: []
      }
      proxy_pool: {
        Row: {
          consecutive_failures: number
          country: string | null
          created_at: string
          failure_count: number
          health_score: number
          id: string
          ip: string
          is_locked: boolean
          is_valid: boolean
          last_checked_at: string | null
          last_error: string | null
          last_latency_ms: number | null
          last_used_at: string | null
          locked_at: string | null
          password: string | null
          port: string
          quarantined_at: string | null
          raw: string
          scheme: string
          success_count: number
          total_uses: number
          username: string | null
        }
        Insert: {
          consecutive_failures?: number
          country?: string | null
          created_at?: string
          failure_count?: number
          health_score?: number
          id?: string
          ip: string
          is_locked?: boolean
          is_valid?: boolean
          last_checked_at?: string | null
          last_error?: string | null
          last_latency_ms?: number | null
          last_used_at?: string | null
          locked_at?: string | null
          password?: string | null
          port: string
          quarantined_at?: string | null
          raw: string
          scheme?: string
          success_count?: number
          total_uses?: number
          username?: string | null
        }
        Update: {
          consecutive_failures?: number
          country?: string | null
          created_at?: string
          failure_count?: number
          health_score?: number
          id?: string
          ip?: string
          is_locked?: boolean
          is_valid?: boolean
          last_checked_at?: string | null
          last_error?: string | null
          last_latency_ms?: number | null
          last_used_at?: string | null
          locked_at?: string | null
          password?: string | null
          port?: string
          quarantined_at?: string | null
          raw?: string
          scheme?: string
          success_count?: number
          total_uses?: number
          username?: string | null
        }
        Relationships: []
      }
      staff_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          used_at?: string | null
        }
        Relationships: []
      }
      user_activation_overrides: {
        Row: {
          daily_limit: number
          note: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          daily_limit?: number
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          daily_limit?: number
          note?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_otp_rate_limit: {
        Args: {
          _cooldown_seconds?: number
          _email: string
          _kind?: string
          _max_per_window?: number
          _window_minutes?: number
        }
        Returns: Json
      }
      consume_access_key: {
        Args: {
          _code_hash: string
          _fingerprint_hash: string
          _ip_hash: string
        }
        Returns: {
          key_id: string
          key_type: string
          ok: boolean
          reason: string
          remaining_uses: number
        }[]
      }
      consume_recovery_code: {
        Args: { _code_hash: string; _ip_hash?: string; _user_id: string }
        Returns: {
          ok: boolean
          reason: string
          remaining: number
        }[]
      }
      count_eligible_cookies: {
        Args: {
          _include_statuses?: string[]
          _min_success_rate?: number
          _min_total_uses?: number
          _require_valid?: boolean
        }
        Returns: number
      }
      count_recent_attempts: {
        Args: { _ip_hash: string; _minutes: number }
        Returns: number
      }
      count_user_recent_attempts: {
        Args: { _minutes: number; _user_id: string }
        Returns: number
      }
      get_proxy_stats: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_cron_schedules: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          schedule: string
        }[]
      }
      log_admin_access_attempt: {
        Args: { _allowed: boolean; _path?: string }
        Returns: undefined
      }
      mark_cookie_invalid: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      pick_next_cookie: {
        Args: never
        Returns: {
          cookies_json: Json
          fingerprint: string
          id: string
        }[]
      }
      pick_next_cookie_by_policy: {
        Args: { _policy?: string }
        Returns: {
          cookies_json: Json
          fingerprint: string
          id: string
        }[]
      }
      pick_next_cookie_filtered: {
        Args: {
          _include_statuses?: string[]
          _min_success_rate?: number
          _min_total_uses?: number
          _policy?: string
          _require_valid?: boolean
        }
        Returns: {
          cookies_json: Json
          fingerprint: string
          id: string
        }[]
      }
      pick_next_proxy: {
        Args: never
        Returns: {
          id: string
          ip: string
          password: string
          port: string
          raw: string
          scheme: string
          username: string
        }[]
      }
      purge_auth_audit_log: { Args: { _days?: number }; Returns: number }
      purge_expired_access_sessions: { Args: never; Returns: number }
      record_otp_attempt: {
        Args: { _email: string; _ip_hash?: string; _kind?: string }
        Returns: undefined
      }
      release_cookie: {
        Args: { _id: string; _outcome?: string; _success: boolean }
        Returns: undefined
      }
      release_proxy: {
        Args: {
          _err?: string
          _id: string
          _latency_ms?: number
          _success: boolean
        }
        Returns: undefined
      }
      run_auto_cleanup: { Args: never; Returns: Json }
      simulate_cookie_selection: {
        Args: {
          _include_statuses?: string[]
          _limit?: number
          _min_success_rate?: number
          _min_total_uses?: number
          _policy?: string
          _require_valid?: boolean
        }
        Returns: Json
      }
      unquarantine_proxy: { Args: { _id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator"
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
      app_role: ["admin", "moderator"],
    },
  },
} as const
