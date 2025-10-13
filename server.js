import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import cors from "cors";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));

const agent = new https.Agent({ rejectUnauthorized: false });

// Safe fetch with timeout
async function safeFetch(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// Fallback tracking
let usingFallback = false;
let lastFallbackTime = 0;
const RETRY_INTERVAL = 2 * 60 * 1000; // retry PHIVOLCS every 2 mins

// ✅ Helper: parse time window
function getStartTime(feed) {
  const now = Date.now();
  switch (feed) {
    case "all_hour": return new Date(now - 1 * 60 * 60 * 1000); // 1 hour
    case "all_week": return new Date(now - 7 * 24 * 60 * 60 * 1000); // 7 days
    case "all_day":
    default:
      return new Date(now - 24 * 60 * 60 * 1000); // 1 day
  }
}

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// ✅ Main PHIVOLCS API route with filter support
app.get("/api/phivolcs", async (req, res) => {
  console.log("🌏 Fetching PHIVOLCS data (no-cache)...");
  try {
    // 👇 add ?nocache timestamp to bust CDN cache
    const liveUrl = `https://earthquake.phivolcs.dost.gov.ph/?t=${Date.now()}`;
    const response = await safeFetch(liveUrl, {
      agent,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      }
    }, 8000);

    if (!response.ok) throw new Error("PHIVOLCS site unreachable");

    const html = await response.text();
    const $ = cheerio.load(html);
    const quakes = [];

    $("table tr").slice(1).each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length < 6) return;
      quakes.push({
        datetime: $(tds[0]).text().trim(),
        latitude: parseFloat($(tds[1]).text().trim()) || 0,
        longitude: parseFloat($(tds[2]).text().trim()) || 0,
        depth: $(tds[3]).text().trim(),
        magnitude: parseFloat($(tds[4]).text().trim()) || 0,
        location: $(tds[5]).text().trim() || "Unknown",
        source: "PHIVOLCS",
      });
    });

    // sort newest first just in case
    quakes.sort((a, b) =>
      new Date(b.datetime) - new Date(a.datetime)
    );

    res.setHeader("Cache-Control", "no-store");
    res.json(quakes);
  } catch (err) {
    console.error("⚠️ PHIVOLCS fetch failed:", err.message);
    await getUSGS(res);
  }
});

// ✅ USGS fallback with feed filtering
async function getUSGS(res, feed) {
  try {
    const startTime = getStartTime(feed);
    console.log(`🌎 Fetching USGS fallback data (${feed})...`);

    const url =
      "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
      "&starttime=" + startTime.toISOString() +
      "&minlatitude=4&maxlatitude=21" +
      "&minlongitude=116&maxlongitude=127" +
      "&minmagnitude=1";

    const response = await safeFetch(url, {}, 8000);
    if (!response.ok) throw new Error("USGS fetch failed");

    const data = await response.json();
    const quakes = data.features.map(eq => ({
      datetime: new Date(eq.properties.time).toLocaleString(),
      latitude: eq.geometry.coordinates[1],
      longitude: eq.geometry.coordinates[0],
      depth: eq.geometry.coordinates[2] + " km",
      magnitude: eq.properties.mag,
      location: eq.properties.place || "Unknown",
      source: "USGS",
    }));

    console.log(`✅ USGS fallback loaded (${quakes.length} records for ${feed})`);
    res.json(quakes);
  } catch (err) {
    console.error("❌ Both PHIVOLCS and USGS failed:", err.message);
    res.status(500).json({ error: "Unable to fetch earthquake data" });
  }
}

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
