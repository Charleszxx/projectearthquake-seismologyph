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

// Helper: parse start time for USGS feed
function getStartTime(feed) {
  const now = Date.now();
  switch (feed) {
    case "all_hour": return new Date(now - 1 * 60 * 60 * 1000);
    case "all_week": return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "all_day":
    default: return new Date(now - 24 * 60 * 60 * 1000);
  }
}

// Disable caching
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

// Main PHIVOLCS API route
app.get("/api/phivolcs", async (req, res) => {
  console.log("🌏 Fetching PHIVOLCS data...");
  try {
    const url = "https://earthquake.phivolcs.dost.gov.ph/";
    const response = await safeFetch(`${url}?t=${Date.now()}`, { agent }, 8000);

    if (!response.ok) throw new Error("Failed to fetch PHIVOLCS page");

    const html = await response.text();
    const $ = cheerio.load(html);

    const quakes = [];

    $("table tbody tr").each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length < 6) return;

      quakes.push({
        datetime: $(tds[0]).text().trim(),
        latitude: parseFloat($(tds[1]).text().trim()) || 0,
        longitude: parseFloat($(tds[2]).text().trim()) || 0,
        depth: $(tds[3]).text().trim(),
        magnitude: parseFloat($(tds[4]).text().trim()) || 0,
        location: $(tds[5]).text().trim(),
        source: "PHIVOLCS",
      });
    });

    if (quakes.length === 0) throw new Error("No earthquake data found");

    // Sort newest first and take top 10
    quakes.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    res.json(quakes.slice(0, 10));
  } catch (err) {
    console.error("⚠️ PHIVOLCS fetch error:", err.message);
    await getUSGS(res); // fallback to USGS
  }
});

// USGS fallback
async function getUSGS(res, feed = "all_day") {
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
      datetime: new Date(eq.properties.time).toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
      latitude: eq.geometry.coordinates[1],
      longitude: eq.geometry.coordinates[0],
      depth: eq.geometry.coordinates[2] + " km",
      magnitude: eq.properties.mag,
      location: eq.properties.place || "Unknown",
      source: "USGS",
    }));

    // Sort newest first and slice top 10
    quakes.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    res.json(quakes.slice(0, 10));
  } catch (err) {
    console.error("❌ Both PHIVOLCS and USGS failed:", err.message);
    res.status(500).json({ error: "Unable to fetch earthquake data" });
  }
}

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
