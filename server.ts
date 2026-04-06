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

  // API Route to fetch latest BG from PM-RN
  app.get("/api/fetch-latest-bg", async (req, res) => {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));
    
    try {
      console.log(`[${new Date().toISOString()}] Attempting to login to PM-RN archives...`);
      const loginUrl = "https://www.arquivos.pm.rn.gov.br/index.php/login";
      const user = process.env.PMRN_USER || "04820582429";
      const password = process.env.PMRN_PASSWORD || "@J0512a1006";

      // 1. Get login page to establish session/get tokens
      console.log(`[${new Date().toISOString()}] GET ${loginUrl}`);
      const loginPage = await client.get(loginUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 60000
      });
      console.log(`[${new Date().toISOString()}] GET ${loginUrl} success: ${loginPage.status}`);

      const $login = cheerio.load(loginPage.data);
      
      // Look for CSRF token if present (common in Nextcloud/PHP apps)
      const requesttoken = $login('head').attr('data-requesttoken') || $login('input[name="requesttoken"]').val();
      
      // Prepare login data
      const formData = new URLSearchParams();
      formData.append('user', user);
      formData.append('password', password);
      if (requesttoken) {
        formData.append('requesttoken', requesttoken as string);
      }

      console.log(`[${new Date().toISOString()}] POST ${loginUrl} for user: ${user}`);
      const loginResponse = await client.post(loginUrl, formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': loginUrl
        },
        maxRedirects: 5,
        timeout: 60000
      });

      console.log(`[${new Date().toISOString()}] POST ${loginUrl} response status: ${loginResponse.status}`);
      console.log(`[${new Date().toISOString()}] Final URL after login: ${loginResponse.config.url}`);

      if (loginResponse.config.url?.includes('login')) {
        // If we are still on the login page, it probably failed
        const $fail = cheerio.load(loginResponse.data);
        const errorMsg = $fail('.error, .warning, .message-error').text().trim();
        if (errorMsg) {
          return res.status(401).json({ error: `Falha no login: ${errorMsg}` });
        }
      }

      // After login, navigate to the BG section
      // The user didn't specify the exact path after login, but usually it's the root or a specific folder.
      // We'll try to find PDF links in the resulting page.
      console.log('Login successful (or redirected). Searching for BG files...');
      
      // If it's a file list, we look for .pdf
      const $ = cheerio.load(loginResponse.data);
      const pdfLinks: { title: string; url: string }[] = [];

      $("a").each((i, el) => {
        const href = $(el).attr("href");
        const text = $(el).text().trim();
        
        if (href && href.toLowerCase().endsWith(".pdf")) {
          const fullUrl = href.startsWith("http") ? href : new URL(href, loginResponse.config.url || loginUrl).toString();
          pdfLinks.push({ title: text || "Boletim Geral", url: fullUrl });
        }
      });

      if (pdfLinks.length === 0) {
        // Try to fetch the main files page if we are still on login or dashboard
        const filesUrl = "https://www.arquivos.pm.rn.gov.br/index.php/apps/files/";
        const filesPage = await client.get(filesUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 60000
        });
        
        const $files = cheerio.load(filesPage.data);
        $files("a").each((i, el) => {
          const href = $files(el).attr("href");
          const text = $files(el).text().trim();
          if (href && href.toLowerCase().endsWith(".pdf")) {
            const fullUrl = href.startsWith("http") ? href : new URL(href, filesUrl).toString();
            pdfLinks.push({ title: text || "Boletim Geral", url: fullUrl });
          }
        });
      }

      if (pdfLinks.length === 0) {
        return res.status(404).json({ error: "Nenhum arquivo de BG encontrado após o login. Verifique se os arquivos estão na pasta inicial." });
      }

      // Sort by title or date if possible, but usually the first one is the latest in these lists
      // For now, take the first one
      const latest = pdfLinks[0];
      
      // We return a proxy URL so the frontend can download it using the server's session
      res.json({
        title: latest.title,
        url: `/api/download-bg?url=${encodeURIComponent(latest.url)}`
      });
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] Error fetching BG:`, error.message);
      if (error.response) {
        console.error(`[${new Date().toISOString()}] Response status:`, error.response.status);
        console.error(`[${new Date().toISOString()}] Response data snippet:`, String(error.response.data).substring(0, 200));
      }
      
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        return res.status(504).json({ error: "O site da PM-RN demorou muito para responder (mais de 60s). Tente novamente em instantes." });
      } else {
        return res.status(500).json({ error: `Erro ao acessar o portal de arquivos: ${error.message}` });
      }
    }
  });

  // Proxy route to download the PDF using the authenticated session
  app.get("/api/download-bg", async (req, res) => {
    const pdfUrl = req.query.url as string;
    if (!pdfUrl) return res.status(400).json({ error: "URL do PDF não informada." });

    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    try {
      const loginUrl = "https://www.arquivos.pm.rn.gov.br/index.php/login";
      const user = process.env.PMRN_USER || "04820582429";
      const password = process.env.PMRN_PASSWORD || "@J0512a1006";

      const loginPage = await client.get(loginUrl, { timeout: 30000 });
      const $login = cheerio.load(loginPage.data);
      const requesttoken = $login('head').attr('data-requesttoken') || $login('input[name="requesttoken"]').val();
      
      const formData = new URLSearchParams();
      formData.append('user', user);
      formData.append('password', password);
      if (requesttoken) formData.append('requesttoken', requesttoken as string);

      await client.post(loginUrl, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      });
      
      console.log(`Proxying PDF download: ${pdfUrl}`);
      const response = await client.get(pdfUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 120000 // 2 minutes for large PDFs
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
