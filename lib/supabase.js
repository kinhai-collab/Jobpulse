// lib/supabase.js
// Server-side Supabase client using the service role key.
// This bypasses RLS and is used only in serverless functions — never exposed to the browser.

const { createClient } = require('@supabase/supabase-js');

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  return createClient(url, key);
}

module.exports = { getServiceClient };
