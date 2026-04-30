# Roastify

A brutally honest career roasting app powered by React + Express + OpenAI.

## Project Structure

- **Frontend** (root): React + Vite app for the UI
- **Backend** (roastify-backend/): Express server for API routes

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

```bash
curl -X POST http://localhost:3001/api/roast \
  -H "Content-Type: application/json" \
  -d '{"input":"my github has 2 repos both called test","type":"github"}'
```

## Build & Deploy

- Frontend build: `npm run build` (creates dist/)
- Backend: Deploy roastify-backend separately to Railway or similar platform
