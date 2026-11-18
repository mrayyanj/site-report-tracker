# Site Report Tracker

A React and TypeScript application for creating and reviewing site reports.

## Features
- Enter a site name, issue description and priority.
- Validate required fields.
- Display a history of reports, with the newest first.
- Save reports in the browser so they remain after a page refresh.
- Delete individual reports after confirming the removal.

## Built with
React, TypeScript and Vite.

## Run locally
Run `npm install`, then `npm run dev`.
Open the local address displayed in the terminal.

## Current behaviour
Reports are saved in this browser using localStorage. They are available at the same site address after a refresh or browser restart. Clearing this site's browser data removes the reports. Reports are specific to the browser and device where they were created.
