import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import cors from "cors";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));

// ✅ Allow insecure SSL (PHIVOLCS SSL issues)
const agent = new https.Agent({
  rejectUnauthorized: false,
});

// ✅ Helper: Timeout-safe fetch
async function safeFetch(url, options = {}, timeout = 10000) {
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

// ✅ Fetch PHIVOLCS and convert to JSON
app.get("/api/phivolcs", async (req, res) => {
  try {
    console.log("🌏 Fetching PHIVOLCS data...");
    const response = await safeFetch("https://earthquake.phivolcs.dost.gov.ph/", { agent });
    if (!response.ok) throw new Error("Failed to fetch PHIVOLCS website");

    const html = await response.text();
    const $ = cheerio.load(html);
    const quakes = [];

    // ✅ Find PHIVOLCS table (skip header row)
    $("table tr").slice(1).each((_, row) => {
      const tds = $(row).find("td");
      const dateStr = $(tds[0]).text().trim().replace("PST", "").trim();

      quakes.push({
        datetime: dateStr,
        latitude: parseFloat($(tds[1]).text().trim()),
        longitude: parseFloat($(tds[2]).text().trim()),
        depth: $(tds[3]).text().trim(),
        magnitude: parseFloat($(tds[4]).text().trim()),
        location: $(tds[5]).text().trim(),
      });
    });

    if (quakes.length === 0) throw new Error("PHIVOLCS returned empty or invalid data");

    console.log(`✅ PHIVOLCS data fetched successfully (${quakes.length} records)`);
    res.json(quakes);
  } catch (err) {
    console.error("⚠️ Error fetching PHIVOLCS data:", err.message);

    // ✅ Fallback: USGS data
    try {
      console.log("🌎 Switching to USGS fallback...");
      const fallbackRes = await safeFetch(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
      );
      if (!fallbackRes.ok) throw new Error("USGS fetch failed");
      const data = await fallbackRes.json();

      const quakes = data.features.map((eq) => {
        const date = new Date(eq.properties.time);
        return {
          datetime: date.toLocaleString(),
          latitude: eq.geometry.coordinates[1],
          longitude: eq.geometry.coordinates[0],
          depth: eq.geometry.coordinates[2] + " km",
          magnitude: eq.properties.mag,
          location: eq.properties.place,
        };
      });

      console.log(`✅ USGS fallback data loaded (${quakes.length} records)`);
      res.json(quakes);
    } catch (fallbackErr) {
      console.error("❌ Both PHIVOLCS and USGS failed:", fallbackErr.message);
      res.status(500).json({ error: "Unable to fetch earthquake data" });
    }
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
