export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      areas: {
        Row: {
          id: number
          name_en: string
          name_ja: string
          slug: string
        }
        Insert: {
          id?: never
          name_en: string
          name_ja: string
          slug: string
        }
        Update: {
          id?: never
          name_en?: string
          name_ja?: string
          slug?: string
        }
        Relationships: []
      }
      artist_aliases: {
        Row: {
          alias_norm: string
          alias_raw: string
          artist_id: string
          created_at: string
        }
        Insert: {
          alias_norm: string
          alias_raw: string
          artist_id: string
          created_at?: string
        }
        Update: {
          alias_norm?: string
          alias_raw?: string
          artist_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "artist_aliases_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      artist_candidates: {
        Row: {
          confidence: string
          event_count: number
          first_seen_at: string
          id: number
          last_seen_at: string
          llm_reason: string | null
          llm_verdict: string | null
          merged_into_artist_id: string | null
          name_display: string
          name_norm: string
          status: string
        }
        Insert: {
          confidence?: string
          event_count?: number
          first_seen_at?: string
          id?: number
          last_seen_at?: string
          llm_reason?: string | null
          llm_verdict?: string | null
          merged_into_artist_id?: string | null
          name_display: string
          name_norm: string
          status?: string
        }
        Update: {
          confidence?: string
          event_count?: number
          first_seen_at?: string
          id?: number
          last_seen_at?: string
          llm_reason?: string | null
          llm_verdict?: string | null
          merged_into_artist_id?: string | null
          name_display?: string
          name_norm?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "artist_candidates_merged_into_artist_id_fkey"
            columns: ["merged_into_artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      artists: {
        Row: {
          bio_en: string | null
          bio_ja: string | null
          created_at: string
          genre_id: number | null
          id: string
          image_url: string | null
          instagram_url: string | null
          name_en: string
          name_ja: string | null
          slug: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          bio_en?: string | null
          bio_ja?: string | null
          created_at?: string
          genre_id?: number | null
          id?: string
          image_url?: string | null
          instagram_url?: string | null
          name_en: string
          name_ja?: string | null
          slug: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          bio_en?: string | null
          bio_ja?: string | null
          created_at?: string
          genre_id?: number | null
          id?: string
          image_url?: string | null
          instagram_url?: string | null
          name_en?: string
          name_ja?: string | null
          slug?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artists_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      event_artists: {
        Row: {
          artist_id: string
          billing_order: number | null
          confidence: string
          event_id: string
          role: string
        }
        Insert: {
          artist_id: string
          billing_order?: number | null
          confidence?: string
          event_id: string
          role?: string
        }
        Update: {
          artist_id?: string
          billing_order?: number | null
          confidence?: string
          event_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_artists_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sources: {
        Row: {
          event_id: string
          raw_payload: Json | null
          scraped_at: string
          source_id: string
          source_url: string
        }
        Insert: {
          event_id: string
          raw_payload?: Json | null
          scraped_at?: string
          source_id: string
          source_url: string
        }
        Update: {
          event_id?: string
          raw_payload?: Json | null
          scraped_at?: string
          source_id?: string
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sources_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          availability: string
          created_at: string
          description: string | null
          doors_time: string | null
          event_date: string
          id: string
          is_featured: boolean
          primary_source_id: string | null
          slug: string | null
          start_time: string | null
          ticket_price_adv: number | null
          ticket_price_door: number | null
          ticket_url: string | null
          title_en: string | null
          title_ja: string | null
          title_norm: string | null
          title_raw: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          availability?: string
          created_at?: string
          description?: string | null
          doors_time?: string | null
          event_date: string
          id?: string
          is_featured?: boolean
          primary_source_id?: string | null
          slug?: string | null
          start_time?: string | null
          ticket_price_adv?: number | null
          ticket_price_door?: number | null
          ticket_url?: string | null
          title_en?: string | null
          title_ja?: string | null
          title_norm?: string | null
          title_raw: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          availability?: string
          created_at?: string
          description?: string | null
          doors_time?: string | null
          event_date?: string
          id?: string
          is_featured?: boolean
          primary_source_id?: string | null
          slug?: string | null
          start_time?: string | null
          ticket_price_adv?: number | null
          ticket_price_door?: number | null
          ticket_url?: string | null
          title_en?: string | null
          title_ja?: string | null
          title_norm?: string | null
          title_raw?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_primary_source_id_fkey"
            columns: ["primary_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      events_rejected: {
        Row: {
          id: number
          payload: Json | null
          raw_line: string
          reason: string
          scraped_at: string
          source_id: string | null
          source_url: string | null
        }
        Insert: {
          id?: number
          payload?: Json | null
          raw_line: string
          reason: string
          scraped_at?: string
          source_id?: string | null
          source_url?: string | null
        }
        Update: {
          id?: number
          payload?: Json | null
          raw_line?: string
          reason?: string
          scraped_at?: string
          source_id?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_rejected_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      genres: {
        Row: {
          id: number
          name_en: string
          name_ja: string
          slug: string
        }
        Insert: {
          id?: never
          name_en: string
          name_ja: string
          slug: string
        }
        Update: {
          id?: never
          name_en?: string
          name_ja?: string
          slug?: string
        }
        Relationships: []
      }
      scrape_logs: {
        Row: {
          duration_ms: number
          error_message: string | null
          fetched: number
          id: number
          parsed: number
          rejected: number
          source_id: string
          started_at: string
          status: string
          unresolved: number
          upserted: number
        }
        Insert: {
          duration_ms?: number
          error_message?: string | null
          fetched?: number
          id?: number
          parsed?: number
          rejected?: number
          source_id: string
          started_at?: string
          status: string
          unresolved?: number
          upserted?: number
        }
        Update: {
          duration_ms?: number
          error_message?: string | null
          fetched?: number
          id?: number
          parsed?: number
          rejected?: number
          source_id?: string
          started_at?: string
          status?: string
          unresolved?: number
          upserted?: number
        }
        Relationships: [
          {
            foreignKeyName: "scrape_logs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          base_url: string
          created_at: string
          display_name: string
          enabled: boolean
          fetch_interval_minutes: number
          id: string
          kind: string
          last_content_hash: string | null
          last_etag: string | null
          last_fetched_at: string | null
          last_modified: string | null
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          base_url: string
          created_at?: string
          display_name: string
          enabled?: boolean
          fetch_interval_minutes?: number
          id: string
          kind: string
          last_content_hash?: string | null
          last_etag?: string | null
          last_fetched_at?: string | null
          last_modified?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          base_url?: string
          created_at?: string
          display_name?: string
          enabled?: boolean
          fetch_interval_minutes?: number
          id?: string
          kind?: string
          last_content_hash?: string | null
          last_etag?: string | null
          last_fetched_at?: string | null
          last_modified?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address_en: string | null
          address_ja: string | null
          area_id: number | null
          capacity: number | null
          created_at: string | null
          description_en: string | null
          description_ja: string | null
          id: string
          image_url: string | null
          instagram_url: string | null
          name_en: string
          name_ja: string
          scrape_enabled: boolean
          scrape_last_at: string | null
          scrape_url: string | null
          slug: string
          twitter_url: string | null
          website_url: string | null
        }
        Insert: {
          address_en?: string | null
          address_ja?: string | null
          area_id?: number | null
          capacity?: number | null
          created_at?: string | null
          description_en?: string | null
          description_ja?: string | null
          id?: string
          image_url?: string | null
          instagram_url?: string | null
          name_en: string
          name_ja: string
          scrape_enabled?: boolean
          scrape_last_at?: string | null
          scrape_url?: string | null
          slug: string
          twitter_url?: string | null
          website_url?: string | null
        }
        Update: {
          address_en?: string | null
          address_ja?: string | null
          area_id?: number | null
          capacity?: number | null
          created_at?: string | null
          description_en?: string | null
          description_ja?: string | null
          id?: string
          image_url?: string | null
          instagram_url?: string | null
          name_en?: string
          name_ja?: string
          scrape_enabled?: boolean
          scrape_last_at?: string | null
          scrape_url?: string | null
          slug?: string
          twitter_url?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      normalize_title: { Args: { input: string }; Returns: string }
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
