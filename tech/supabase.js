// Supabase client — shared across all portal pages
// SUPABASE_URL and SUPABASE_ANON_KEY are injected by Netlify environment variables
// In local dev, replace the values below temporarily (never commit real keys)

const SUPABASE_URL  = window.ENV_SUPABASE_URL  || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON = window.ENV_SUPABASE_ANON || 'YOUR_SUPABASE_ANON_KEY';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
