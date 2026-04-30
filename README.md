# Roastify

A brutally honest profile roasting app powered by React + Express + OpenAI.

## Features

- **GitHub**: Roasts your public GitHub profile using the GitHub API
- **LinkedIn**: Accepts LinkedIn URLs and guides you to share key details
- **Instagram**: Takes Instagram URLs with user-provided bio & engagement data
- **Twitter/X**: Roasts your Twitter/X profile with your tweet style details

## Project Structure

- **Frontend** (root): React + Vite app for the UI
- **Backend** (roastify-backend/): Express server for API routes & profile fetching

## Setup

### Prerequisites
- Node.js 20 or newer

### Frontend Setup

1. In the project root, install dependencies:
```bash
npm install
```

2. Optional: create `.env` in the project root if backend is not running on localhost:3001:
```bash
VITE_API_BASE_URL=http://localhost:3001
```

3. Start the frontend dev server:
```bash
npm run dev
```

The app will run on `http://localhost:5173`.

### Backend Setup

1. Navigate to the backend directory:
```bash
cd roastify-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file in roastify-backend:
```bash
OPENAI_API_KEY=your_openai_api_key_here
```

4. Start the backend dev server:
```bash
npm run dev
```

The API will run on `http://localhost:3001`.

## Running Both Simultaneously

Open two terminal windows:
- Terminal 1: `npm run dev` (from root, runs frontend on 5173)
- Terminal 2: `cd roastify-backend && npm run dev` (runs backend on 3001)

## Testing the API

### GitHub (fully automated)
```bash
curl -X POST http://localhost:3001/api/roast \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/octocat","type":"github"}'
```

### LinkedIn (needs user input)
```bash
curl -X POST http://localhost:3001/api/roast \
  -H "Content-Type: application/json" \
  -d '{"url":"https://linkedin.com/in/yourprofile","type":"linkedin"}'
```

The API will return a prompt requesting profile details (job title, company, connections, etc.).

### Twitter (needs user input)
```bash
curl -X POST http://localhost:3001/api/roast \
  -H "Content-Type: application/json" \
  -d '{"url":"https://twitter.com/yourhandle","type":"twitter"}'
```

## Build & Deploy

- Frontend build: `npm run build` (creates dist/)
- Backend: Deploy roastify-backend separately to Railway or similar platform
