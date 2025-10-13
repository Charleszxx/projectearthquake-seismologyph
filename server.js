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

// ✅ Main PHIVOLCS Endpoint
app.get("/api/phivolcs", async (req, res) => {
  try {
    console.log("🌏 Fetching PHIVOLCS data...");
    const PHIVOLCS_TIMEOUT = 5000; // ⏱️ Faster fetch timeout

    const response = await safeFetch("https://earthquake.phivolcs.dost.gov.ph/", { agent }, PHIVOLCS_TIMEOUT);
    if (!response.ok) throw new Error("Failed to fetch PHIVOLCS website");

    const html = await response.text();
    const $ = cheerio.load(html);
    const quakes = [];

    // ✅ Parse PHIVOLCS table (skip header)
    $("table tr").slice(1).each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length < 6) return;

      const dateStr = $(tds[0]).text().trim().replace("PST", "").trim();
      if (!dateStr) return;

      quakes.push({
        datetime: dateStr,
        latitude: parseFloat($(tds[1]).text().trim()) || 0,
        longitude: parseFloat($(tds[2]).text().trim()) || 0,
        depth: $(tds[3]).text().trim(),
        magnitude: parseFloat($(tds[4]).text().trim()) || 0,
        location: $(tds[5]).text().trim() || "Unknown",
        source: "PHIVOLCS",
      });
    });

    if (quakes.length === 0) throw new Error("PHIVOLCS returned empty or invalid data");

    console.log(`✅ PHIVOLCS data fetched successfully (${quakes.length} records)`);
    res.json(quakes);
  } catch (err) {
    console.error("⚠️ PHIVOLCS fetch failed:", err.message);

    // ✅ Fallback: USGS (Philippines-only)
    try {
      console.log("🌎 Switching to USGS fallback (Philippines only)...");
      const fallbackUrl =
        "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
        "&starttime=" + new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() + // past 24h
        "&minlatitude=4&maxlatitude=21" +
        "&minlongitude=116&maxlongitude=127" +
        "&minmagnitude=1";

      const fallbackRes = await safeFetch(fallbackUrl, {}, 8000);
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
          source: "USGS",
        };
      });

      console.log(`✅ USGS fallback data loaded (${quakes.length} PH records)`);
      res.json(quakes);
    } catch (fallbackErr) {
      console.error("❌ Both PHIVOLCS and USGS failed:", fallbackErr.message);
      res.status(500).json({ error: "Unable to fetch earthquake data" });
    }
  }
});

// ✅ Start Server
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
