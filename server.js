import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));

// Create HTTPS agent that ignores invalid SSL certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ✅ PHIVOLCS proxy endpoint
app.get("/api/phivolcs", async (req, res) => {
  try {
    const response = await fetch("https://earthquake.phivolcs.dost.gov.ph/", {
      agent: httpsAgent,
    });

    if (!response.ok) throw new Error("Failed to fetch PHIVOLCS data");

    const html = await response.text();
    res.set("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    console.error("Error fetching PHIVOLCS data:", err);
    res.status(500).json({ error: "Unable to fetch PHIVOLCS data" });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
