# Examples

This directory holds reference implementations of common patterns built on top of the starter.
**They are not part of the starter itself** — the template ships zero design.

## Frontend pages

`frontend-pages/` contains minimal but functional Next.js pages demonstrating how to consume the AuthContext and api wrapper:

- `login.tsx` — POST /api/auth/login, on success redirect to /dashboard
- `signup.tsx` — POST /api/auth/signup with the same flow
- `dashboard.tsx` — useAuth() guard + logout
- `payment-success.tsx` and `payment-failure.tsx` — payment redirect landing pages

To use one: copy the file into `frontend/src/app/<route>/page.tsx`, restyle it for your design.
