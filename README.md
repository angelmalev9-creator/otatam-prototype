# OTATAM Prototype

Functional V1 proof-of-concept for OTATAM.

## Working now
- Questionnaire → trip generation
- Open-Meteo geocoding + live weather
- OpenStreetMap / Overpass places with Wikipedia fallback
- Multi-day itinerary assembly
- Confidence markers (verified / estimated / check before booking)
- Budget planning + buffer
- TODAY / TRIP / MAP / EXPLORE / BUDGET client interface
- Human review status before publish

## Intentionally not faked
Flights, hotel inventory, tickets, live prices and availability are marked `CHECK BEFORE BOOKING`.
Production V1 should connect approved commercial providers and add auth/database/payments/admin persistence.

## Deploy
Vercel can deploy this repository directly. `index.html` is the client and `/api/trip.js` is a Vercel serverless function.
