# Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `migrations/20261005000000_create_workgrid_data.sql`.
3. In Authentication > URL Configuration, set the site URL or an allowed redirect URL to `https://zhoubx634.github.io/workgrid/`.
4. Copy the Project URL and publishable/anon key into the GitHub Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## Email code template

WorkGrid accepts a six-digit email code in the same browser and keeps the magic link as a fallback. In Authentication > Emails, edit the Magic Link template so the body includes both `{{ .Token }}` and `{{ .ConfirmationURL }}`. For example:

```html
<h2>登录 WorkGrid</h2>
<p>你的邮箱验证码是：</p>
<p style="font-size: 28px; font-weight: 700;">{{ .Token }}</p>
<p>在发送验证码的 WorkGrid 页面输入它即可登录。</p>
<p><a href="{{ .ConfirmationURL }}">也可以点击这里登录</a></p>
```

Save the template before testing email-code login. Do not remove `{{ .ConfirmationURL }}` unless magic-link fallback is intentionally disabled.

The browser must use only the publishable/anon key. Never expose the service role key. Row-level security in the migration restricts every row to its authenticated owner.
