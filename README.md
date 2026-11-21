# Site Report Tracker

A full-stack application for recording site issues, assigning priorities and reviewing report history.

## Features

- Create reports with a site name, issue description and priority.
- Validate required fields in the browser and API.
- List reports with the newest first.
- Save reports to a SQLite database on the server.
- Delete reports through an in-page confirmation dialog.
- Use a responsive layout with priority badges and report overview counts.
- Show loading, success and error messages.
- Import reports from the earlier browser-storage version while retaining a backup.
- Reuse report IDs when retrying requests to avoid duplicate records.

## Stack

React, TypeScript, Vite, Node.js HTTP and SQLite through node:sqlite.

## Run locally

1. Install Node.js 24 or newer.
2. Run `npm install` in the project folder.
3. Run `npm run dev:api` in one terminal.
4. Run `npm run dev` in another terminal.
5. Open http://localhost:5173 and keep both terminals running.

In Windows PowerShell, `npm.cmd` can be used in place of `npm`.

Vite forwards /api requests to http://127.0.0.1:3001.

## API

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | /api/health | Check that the API is running. |
| GET | /api/reports | List reports, newest first. |
| POST | /api/reports | Save a report. |
| DELETE | /api/reports/:id | Delete a report; retries are safe. |

POST accepts siteName, description and priority: Low, Medium or High.

An optional id supports retries and importing old reports. Repeating the same ID and details returns the existing report. Conflicting details return HTTP 409.

## Data storage

The API creates server/data/reports.sqlite automatically. The server/data/ folder is ignored by Git.

Reports remain after a browser refresh or server restart. Removing the database removes its reports.

When earlier browser reports are found at the same site address, use Import browser reports. The original browser data is retained as a backup. Interrupted imports can be retried.

## Checks

Run `npm test`, `npm run lint`, `npm run build` and `npm audit`.

## Automated API checks

`npm test` runs 10 integration tests using Node's built-in test runner.

Each test starts an API on a separate available port and uses a temporary SQLite database. Tests can run while the normal app is running. Temporary databases are removed afterwards.

The tests cover report creation, validation, ordering, request retries, conflicting IDs, restart persistence and deletion.

The GitHub Actions workflow runs tests, lint and the production build on Ubuntu and Windows for pushes and pull requests.

Popup appearance and keyboard interactions remain manual browser checks.

## Current scope

This is a local development project with create, list and delete operations.

Authentication and report editing are future work.