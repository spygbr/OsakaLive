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
      artists: {
        Row: {
          bio_en: string | null
          bio_ja: string | null
          created_at: string | null
          genre_id: number | null
          id: string
          image_url: string | null
          instagram_url: string | null
          name_en: string
          name_ja: string | null
          slug: string
          website_url: string | null
        }
        Insert: {
          bio_en?: string | null
          bio_ja?: string | null
          created_at?: string | null
          genre_id?: number | null
          id?: string
          image_url?: string | null
          instagram_url?: string | null
          name_en: string
          name_ja?: string | null
          slug: string
          website_url?: string | null
        }
        Update: {
          bio_en?: string | null
          bio_ja?: string | null
          created_at?: string | null
          genre_id?: number | null
          id?: string
          image_url?: string | null
          instagram_url?: string | null
          name_en?: string
          name_ja?: string | null
          slug?: string
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
          event_id: string
        }
        Insert: {
          artist_id: string
          billing_order?: number | null
          event_id: string
        }
        Update: {
          artist_id?: string
          billing_order?: number | null
          event_id?: string
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
      event_genres: {
        Row: {
          event_id: string
          genre_id: number
        }
        Insert: {
          event_id: string
          genre_id: number
        }
        Update: {
          event_id?: string
          genre_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_genres_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          availability: string
          created_at: string | null
          description_en: string | null
          description_ja: string | null
          doors_time: string | null
          drink_charge: number | null
          event_date: string
          id: string
          is_featured: boolean | null
          slug: string
          start_time: string | null
          ticket_price_adv: number | null
          ticket_price_door: number | null
          ticket_url: string | null
          title_en: string
          title_ja: string | null
          updated_at: string | null
          venue_id: string
        }
        Insert: {
          availability?: string
          created_at?: string | null
          description_en?: string | null
          description_ja?: string | null
          doors_time?: string | null
          drink_charge?: number | null
          event_date: string
          id?: string
          is_featured?: boolean | null
          slug: string
          start_time?: string | null
          ticket_price_adv?: number | null
          ticket_price_door?: number | null
          ticket_url?: string | null
          title_en: string
          title_ja?: string | null
          updated_at?: string | null
          venue_id: string
        }
        Update: {
          availability?: string
          created_at?: string | null
          description_en?: string | null
          description_ja?: string | null
          doors_time?: string | null
          drink_charge?: number | null
          event_date?: string
          id?: string
          is_featured?: boolean | null
          slug?: string
          start_time?: string | null
          ticket_price_adv?: number | null
          ticket_price_door?: number | null
          ticket_url?: string | null
          title_en?: string
          title_ja?: string | null
          updated_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
