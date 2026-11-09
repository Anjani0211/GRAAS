# GRAAS — Grievance Redressal & Assistance System

A full-stack cybercrime assistance platform built with Next.js and Express.

## Tech Stack

**Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, Framer Motion, Recharts, Zustand

**Backend:** Node.js 22+, Express, TypeScript, MongoDB + Mongoose, Zod validation

## Project Structure

```
graas/
├── web/                    # Next.js frontend
│   ├── app/
│   │   ├── (public)/       # Landing, submit, track, login
│   │   ├── (victim)/       # Victim portal
│   │   └── (admin)/        # Admin/staff portal
│   ├── components/
│   │   ├── ui/             # Base UI components
│   │   ├── case/           # Case-specific components
│   │   └── layout/         # Layout components
│   └── lib/                # Utils, store, types, mock data
├── api/                    # Express + MongoDB backend
│   └── src/
│       ├── config/         # Database connection, env config
│       ├── models/         # Mongoose schemas (Case, OsintReport, etc.)
│       ├── routes/         # API route handlers
│       └── app.ts          # Express server entry point
└── README.md
```

## Getting Started

> **Node.js 22+ is required.** Next.js 16 and the bundled undici client fail on
> Node 20 (`webidl.util.markAsUncloneable is not a function`). A `.nvmrc` is
> included — run `nvm use` before starting the apps.

### Frontend

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Backend

```bash
cd api
npm install
npm run dev
```

API runs on [http://localhost:8000](http://localhost:8000).
API docs: [http://localhost:8000/api/health](http://localhost:8000/api/health).

### Prerequisites

- **Node.js** 22+ (Node 22 LTS recommended)
- **MongoDB** running locally or a MongoDB Atlas connection string

Set your MongoDB URI in `api/.env`:

```env
MONGODB_URI=mongodb://localhost:27017/graas
```

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/cases` | Create a new case |
| GET | `/api/cases` | List cases (filter by status, severity, category) |
| GET | `/api/cases/:id` | Get case by ID |
| PATCH | `/api/cases/:id/status` | Update case status |
| POST | `/api/triage` | AI triage — classify severity and category |
| GET | `/api/osint/whois?domain=` | WHOIS domain lookup |
| GET | `/api/osint/ip?ip=` | IP geolocation lookup |
| GET | `/api/osint/urlscan?url=` | URL reputation scan |
| GET | `/api/osint/shodan?query=` | Shodan search |
| POST | `/api/escalation` | Create escalation action |
| GET | `/api/escalation/templates` | List legal templates |
| POST | `/api/notifications/send` | Send notification (SMS/Email/WhatsApp) |
| GET | `/api/notifications/history/:caseId` | Notification history for a case |

## Frontend Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/submit` | 5-step complaint wizard |
| `/track` | Case lookup page |
| `/track/[caseId]` | Public case tracker |
| `/login` | Auth page |
| `/victim/dashboard` | Victim case overview |
| `/victim/case/[id]` | Case detail + messages |
| `/victim/support` | Legal & psychological support |
| `/admin/dashboard` | Admin command center |
| `/admin/cases` | All cases (filterable) |
| `/admin/case/[id]` | Full case workspace |
| `/admin/analytics` | Charts & KPIs |
| `/admin/team` | Team management |
| `/admin/settings` | Platform config |

## Environment Variables

### Frontend (`web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

### Backend (`api/.env`)

```env
PORT=8000
MONGODB_URI=mongodb://localhost:27017/graas
JWT_SECRET=your-secret-key
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```
