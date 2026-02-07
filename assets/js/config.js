// assets/js/config.js
// REQUIRED: fill your Supabase details before loading admin.html
const SUPABASE_URL = 'https://xfhvwszyrqvotobvakup.supabase.co'; // <-- set this
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmaHZ3c3p5cnF2b3RvYnZha3VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1Mjc0MzcsImV4cCI6MjA4NTEwMzQzN30.9E_qelxVGJbCOnmnJzRXPbfn8QuYPXod5QU3j5TBfFA'; // <-- set this

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('YOUR')) {
    console.warn('Supabase not configured. Open assets/js/config.js and set SUPABASE_URL & SUPABASE_ANON_KEY.');
}

window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
});
