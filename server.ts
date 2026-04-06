import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route to fetch latest BG from PM-RN (Public Website)
  app.get("/api/fetch-latest-bg", async (req, res) => {
    try {
      console.log(`[${new Date().toISOString()}] Fetching latest BG from public PM-RN website...`);
      const url = "http://www.pm.rn.gov.br/boletim-geral/";
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 30000
      });

      const $ = cheerio.load(response.data);
      const pdfLinks: { title: string; url: string }[] = [];

      // Find all links that end with .pdf
      $("a").each((i, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        
        if (href && href.toLowerCase().endsWith(".pdf")) {
          // Normalize URL if relative
          const fullUrl = href.startsWith("http") ? href : new URL(href, url).toString();
          pdfLinks.push({ title: text || "Boletim Geral", url: fullUrl });
        }
      });

      if (pdfLinks.length === 0) {
        return res.status(404).json({ error: "Nenhum arquivo de BG encontrado no site público da PM-RN." });
      }

      // Usually the first one is the latest
      const latest = pdfLinks[0];
      
      // We return a proxy URL to avoid CORS issues in the frontend
      res.json({
        title: latest.title,
        url: `/api/download-bg?url=${encodeURIComponent(latest.url)}`
      });
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] Error fetching BG:`, error.message);
      res.status(500).json({ error: "Erro ao buscar o BG no site da PM-RN. Verifique se o site está acessível." });
    }
  });

  // Proxy route to download the PDF (handles CORS and potential referrer checks)
  app.get("/api/download-bg", async (req, res) => {
    const pdfUrl = req.query.url as string;
    if (!pdfUrl) return res.status(400).json({ error: "URL do PDF não informada." });

    try {
      console.log(`Proxying PDF download: ${pdfUrl}`);
      const response = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'http://www.pm.rn.gov.br/'
        },
        timeout: 60000
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="boletim.pdf"`);
      res.send(response.data);
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] Error proxying PDF:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: `Erro ao baixar o arquivo PDF: ${error.message}` });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
