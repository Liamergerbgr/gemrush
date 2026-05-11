// Supabase client for Workers (service_role — bypasses RLS)
import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabase(env) {
  if (!_client) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return _client;
}

// Verify player JWT and return user id
export async function verifyAuth(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Admin key check
export function verifyAdmin(request, env) {
  const key = request.headers.get('X-Admin-Key');
  return key && key === env.ADMIN_SECRET_KEY;
}
