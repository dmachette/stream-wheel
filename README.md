# Stream Wheel - Full Package

This package contains the full Stream Wheel project with all extras (profiles, uploads, logs archive, admin UI, overlay, leaderboard).

Quickstart:
1. Install Node 18+
2. cd backend
3. npm install
4. cp .env.example .env  # edit ADMIN_PASS, ADMIN_VIEW_PASS, API_KEY as needed
5. npm start
6. Admin: http://localhost:3000/admin/admin.html
7. Overlay: http://localhost:3000/public/index.html?profile=default&token=<token-from-config>

Profiles are stored in /profiles. Logs and archives are under each profile folder.
