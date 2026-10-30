# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS (no build step), Leaflet map, deployed on Vercel from GitHub (aucordier69/diesel).

## Users

Public, mostly drivers of diesel cars in the Rhône (69) and the four departments touching it: Ain (01), Isère (38), Loire (42), Saône-et-Loire (71). The founder is a frequent long-distance diesel driver who compares station prices. Used both calmly at home (trip prep) and in a hurry on a phone at a stop (parking, station, bright light), where the answer must read in seconds. Primary device: phone.

## Product Purpose

List every station of the Rhône and its four neighbouring departments that sells the visitor's chosen fuel (gazole by default; also SP95-E10, SP98, E85, SP95, GPL) with its current price, filterable by department and commune, with a map. Success: a visitor finds the cheapest nearby fuel in a glance and goes there.

## Positioning

Rhône and neighbouring departments only, one fuel at a time (diesel first), official prices (prix-carburants.gouv.fr open data, refreshed about every 10 minutes), no account, no ads: a narrow, fast comparison tool rather than a general fuel portal.

## Operating Context

Data fetched live in the browser on every open from data.economie.gouv.fr (Licence Ouverte 2.0), about 780 stations across 5 departments (about 190 in the Rhône), of which about 720 sell diesel, 590 SP95-E10, 580 SP98, 300 E85, 220 SP95 and 100 GPL. Prices carry an update date that can be days old, which matters for trust.

## Capabilities and Constraints

- Ranked list (cheapest first) with price tiers green / orange / red relative to the Rhône range.
- Department toggle buttons (all on by default, desktop only: on phones every department is always shown), then a commune selector limited to the chosen departments, with a "× Toutes" button next to it that resets the commune in one tap; the map opens centred on the Rhône. Clicking a station focuses the map and opens its popup (name, address, price, update date).
- Map right of the list on desktop, above the list on phone.
- First visit: a full-screen welcome states the purpose in one sentence ("Retrouve les prix de ton carburant dans les stations du Rhône et les départements limitrophes."), lets the visitor choose a fuel (gazole preselected; only that fuel's prices are fetched, only stations selling it are shown everywhere; the choice is remembered in `localStorage` key `carburant`, the current fuel is named in the summary line, changing fuel loads its prices, cached for 10 minutes) and offers either to type a commune and press "go" (the map zooms on it, the list keeps every station) or to press "go (sans commune)". An unknown or out-of-zone commune gets "Connais-tu ta géographie ?". The welcome is remembered in `localStorage` (`accueil-vu`) and can be reopened with the "?" button.
- Commune lookup uses geo.api.gouv.fr (public, no key); the typed text is the only user data that leaves the browser.
- Phones only: a "Y aller" link on each station (in its map popup and on the selected list row) opens the phone's maps app with driving directions to the station (Apple Plans on iPhone, Google Maps elsewhere).
- Fuel: one at a time, changed through the "?" welcome. Language: French.
- Must keep working without a server; no API key.

## Brand Commitments

None established. Title "La pétrolette des chouquettes" (the user's wording; the project repo is called "diesel"). Tone of voice: informal "tu" ("Retrouve le prix des carburants…", "Connais-tu ta géographie ?").

## Evidence on Hand

Live open-data feed only. No logo, photos, testimonials or usage numbers; none may be invented.

## Product Principles

- Glanceability over decoration: the price is the hero.
- Honest data: always show how fresh a price is; never imply certainty the feed does not give.
- Phone first, one hand, bright light.
- Quiet and fast: no accounts, no ads, nothing to learn.

## Accessibility & Inclusion

Readable in direct sunlight on a phone; price tiers must not rely on color alone; touch targets sized for use at a stop.
