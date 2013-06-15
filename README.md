DDOT GTFS Realtime service
==========================

This service receives updates from the DDOT Automatic Vehicle Location (AVL) system and provides a GTFS Realtime Trip Updates feed based on that data.

The service receives 3 basic sets of information from 2 sources:

- the static GTFS package is fetched via HTTP
- static data from the AVL system is posted by a separate tool on the same network as the AVL database
- live adherence data from the AVL system is posted by the same tool

We use the following environment variable for the HTTP transaction:

- `GTFS_URL` : the HTTP URL of the GTFS ZIP file

For example, you might host your latest GTFS package on a server called `data.mytransitagency.gov` at the path `/transit/static/gtfs.zip` accessible by the user `transitbot` with the password `supers3cr3t`.

The service uses static data from the AVL system to create a translation from AVL IDs to GTFS IDs. The AVL tool posts static data to the following endpoints: `/static-avl/blocks`, `/static-avl/trips`, and `/static-avl/stops`. The service can then map the trip IDs in the live AVL data to GTFS trip IDs. The AVL tool regularly posts that live adherence data to `/adherence`.

The path for the trip updates feed is `/gtfs-realtime/trip-updates`. To check the data (i.e. for debugging purposes), a JSON version of the feed is available at `/gtfs-realtime/trip-updates.json`.

We have designed this app to run on a platform like Heroku.
