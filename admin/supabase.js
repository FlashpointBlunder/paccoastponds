const SUPABASE_URL  = 'https://wxrifqyqhgkllslprtai.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4cmlmcXlxaGdrbGxzbHBydGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNzUxMzMsImV4cCI6MjA4NzY1MTEzM30.Rnfg9eIQkvnyHMMyYn1GS1LYuZFJ32mxR1qWieS4RkA';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
