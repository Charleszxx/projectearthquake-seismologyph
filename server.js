import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio"; // ✅ for parsing HTML
import cors from "cors";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));

// ✅ Ignore invalid SSL from PHIVOLCS (Render servers fail verification)
const agent = new https.Agent({
  rejectUnauthorized: false
});

// ✅ PHIVOLCS → JSON proxy
app.get("/api/phivolcs", async (req, res) => {
  try {
    const response = await fetch("https://earthquake.phivolcs.dost.gov.ph/", { agent });
    if (!response.ok) throw new Error("Failed to fetch PHIVOLCS site");

    const html = await response.text();
    const $ = cheerio.load(html);

    const quakes = [];

    $("table tr").slice(1).each((_, row) => {
      const tds = $(row).find("td");
      const dateStr = $(tds[0]).text().trim().replace("PST", "").trim();

      quakes.push({
        datetime: dateStr,
        latitude: parseFloat($(tds[1]).text().trim()),
        longitude: parseFloat($(tds[2]).text().trim()),
        depth: $(tds[3]).text().trim(),
        magnitude: parseFloat($(tds[4]).text().trim()),
        location: $(tds[5]).text().trim()
      });
    });

    res.json(quakes);
  } catch (err) {
    console.error("Error fetching PHIVOLCS data:", err);
    res.status(500).json({ error: "Unable to fetch PHIVOLCS data" });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
