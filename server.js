import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));

// HTTPS agent to ignore invalid SSL (sometimes PHIVOLCS has weak certs)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ✅ PHIVOLCS proxy (scrapes HTML safely)
app.get("/api/phivolcs", async (req, res) => {
  try {
    const response = await fetch("https://earthquake.phivolcs.dost.gov.ph/", {
      agent: httpsAgent,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SeismoDashboard/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) throw new Error("Failed to fetch PHIVOLCS page");

    const html = await response.text();

    // ✅ CORS header (important for your frontend)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("❌ Error fetching PHIVOLCS data:", err);
    res.status(500).json({ error: "Unable to fetch PHIVOLCS data" });
  }
});

// ✅ USGS fallback route (for when PHIVOLCS is down)
app.get("/api/usgs", async (req, res) => {
  try {
    const response = await fetch(
      "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
    );
    if (!response.ok) throw new Error("Failed to fetch USGS data");

    const data = await response.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching USGS data:", err);
    res.status(500).json({ error: "Unable to fetch USGS data" });
  }
});

app.listen(PORT, () =>
  console.log(`✅ Seismology API server running on port ${PORT}`)
);
