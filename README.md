# RememberMe

RememberMe is an assistive memory aid for people living with dementia. A caregiver sets up the people and reminders that matter to someone, and then the app watches through a camera, recognizes a face in real time, and surfaces a simple card that says who the person is and any reminder attached to them. It can also listen to a conversation, pull out the details worth keeping, and save them as memories the person can look back on. It was built as a team project.

## What it does

- Recognizes faces from a live camera feed and shows an identity card for the person in view
- Surfaces reminders tied to a person or a time
- Captures a conversation through speech, and uses a language model to turn it into structured memories rather than a raw transcript
- Gives caregivers a dashboard to manage patients, faces, reminders, and memories
- Talks back through text to speech, and takes input through speech to text

## Architecture

The system has three parts:

- **Backend** (`backend/`): a FastAPI service. Its routes are split by concern under `app/routers/`: `auth` for sign-in, `faces` and `pending_faces` for face enrollment and recognition, `memories`, `reminders`, `patients`, `conversations`, `stt` and `tts` for speech, and `ws` for the real-time WebSocket the interface listens on. Business logic lives in `app/services/`, the schema is managed with SQL migrations under `app/migrations/`, and requests are rate limited. There is a test suite under `backend/tests/`.
- **Patient interface** (`RememberMeInterface/`): the real-time app the person actually uses. It runs the camera, detects faces, listens for a voice trigger, and shows the identity and reminder cards. Built with React, Vite, TypeScript, and Tailwind.
- **Caregiver dashboard** (`dashboard/`): where a caregiver enrolls faces and manages reminders and memories.

The `docs/` folder has the fuller design writeups (architecture, data schemas, the recognition and memory pipeline, and the API spec).

## Running it locally

Each part has its own setup. In short: create the backend environment, install its `requirements.txt`, set the environment variables it needs (an `.env.example` shows which), run the migrations, and start the FastAPI server. Then install and run each frontend with its own package manager and point it at the backend. `DEPLOY.md` covers a full deployment.

## A note on the docs

`CLAUDE.md` in the root is an internal working document for the build, not user-facing docs. Start with this README and the files under `docs/`.
