import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Server-side Supabase client for use in Server Components, Route Handlers,
 * and generateStaticParams. Uses the same anon key — swap for a service role
 * key if you need to bypass RLS in trusted server contexts.
 */
export function createServerClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
      },
    }
  )
}
