# Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `migrations/20261005000000_create_workgrid_data.sql`.
3. In Authentication > URL Configuration, set the site URL or an allowed redirect URL to `https://zhoubx634.github.io/workgrid/`.
4. Copy the Project URL and publishable/anon key into the GitHub Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

The browser must use only the publishable/anon key. Never expose the service role key. Row-level security in the migration restricts every row to its authenticated owner.
