# Golden Compass Navigator

I have a complete, fully designed frontend HTML file for an investment app called "Golden Compass" (file: golden-compass-v6-3.html) and a detailed backend implementation guide (golden-compass-backend-guide.docx). I need you to merge them into a single, deployable full‑stack application.



**Frontend (already built):**

- File: golden-compass-v6-3.html (provided below)

- It includes all screens: login, signup, home, pools, AI navigator chat, history, licenses, profile, admin panel.

- It uses a demo mode with local JavaScript state (mock data). All UI, animations, and micro‑interactions are complete.



**Backend Implementation Guide:**

- Outlines a Node.js/Express API server with Supabase (PostgreSQL), JWT auth, M‑Pesa sandbox integration, OpenAI GPT‑4o Mini for the AI Navigator, Resend for emails, Upstash Redis for caching.

- Contains exact database schema, API routes, environment variables, and deployment steps.



**Goal:**

Create a fully functional app that uses the provided frontend HTML/CSS/JS but replaces the mock/demo logic with real API calls to a backend that follows the implementation guide.



**Specific Requirements:**



1. **Frontend Integration:**

   - Keep the existing HTML structure, CSS, and all visual effects (glassmorphism, 3D tilt, parallax, etc.).

   - Replace the mock authentication and data functions with fetch() calls to a backend API.

   - Add the `apiFetch` wrapper (with token refresh logic) as described in Section 7.1 of the guide.

   - Map all user actions to the corresponding backend endpoints (login, register, deposit, withdraw, AI chat, KYC, admin actions, etc.) as listed in Section 7.4.

   - Use the frontend’s existing UI states (loading spinners, success checkmarks, error toasts) during API calls.



2. **Backend Implementation:**

   - Follow the guide exactly: Node.js + Express, Supabase for database/auth, JWT for sessions.

   - Create all 7 database tables using the SQL migration provided in Section 4.3.

   - Implement all routes and services as outlined in Section 6 (auth, pools, M‑Pesa, AI, email, admin).

   - For M‑Pesa, use the Safaricom Daraja sandbox with the credentials provided in the guide (shortcode 174379, passkey etc.).

   - Use OpenAI GPT‑4o Mini for the AI Navigator, injecting the user’s actual portfolio data into the system prompt.

   - Send emails via Resend for welcome, deposit confirmation, and KYC status updates.

   - Include a daily NAV update cron job (simulate random NAV changes for demo).

   - Implement rate limiting, Helmet.js, and CORS (allow the frontend URL).



3. **Environment Configuration:**

   - Set up a `.env` file with all required keys (Supabase URL/service key, JWT secrets, OpenAI key, Resend key, M‑Pesa sandbox credentials, etc.).

   - Use the sandbox M‑Pesa callback URL (you can use a placeholder like `https://your-ngrok-url.ngrok.io/api/mpesa/callback` and instruct the user to update it).



4. **Deployment:**

   - The final app should be deployable to Vercel (frontend) and Render.com (backend) with minimal changes.

   - The frontend `API_URL` constant should be configurable (use environment variable in build or a single config).



5. **Testing / Demo Mode:**

   - While the backend should be real, it can remain in "simulation" mode for M‑Pesa (sandbox) and NAV updates (randomized).

   - Admin panel should be functional: approve/reject KYC, update NAV, view audit logs.



**Frontend Code (golden-compass-v6-3.html) is provided below. Please use it as the starting point for the UI.**



[PASTE THE ENTIRE CONTENTS OF golden-compass-v6-3.html HERE]



**Additional Instructions:**

- If you are generating a Next.js or React project, migrate the HTML structure into components while preserving all CSS classes and animations exactly as they are.

- The final output should be a ready‑to‑run codebase that I can deploy immediately after setting the environment variables.

- Include a `README.md` with setup instructions based on the guide.



Now using the exact design, code and files I have given, build the merged full‑stack Golden Compass application.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://thegolden-compass.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/979a9f06-b701-472a-bad9-2709d492d86b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
