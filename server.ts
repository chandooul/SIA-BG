import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (e) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT:", e);
  }
} else {
  // Fallback or warning
  console.warn("FIREBASE_SERVICE_ACCOUNT not found. Backend Firestore access may fail.");
  // If we are in a Google Cloud environment (like Cloud Run), it might work with default credentials
  try {
    admin.initializeApp();
  } catch (e) {
    console.warn("Default Firebase Admin initialization failed.");
  }
}

const db = admin.firestore();

// Text normalization helpers (consistent with frontend)
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTextFuzzy(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Route for notifications
  app.post("/api/notify", async (req, res) => {
    const { fullText, docInfo } = req.body;

    if (!fullText || !Array.isArray(fullText)) {
      return res.status(400).json({ error: "Missing fullText array" });
    }

    try {
      // 1. Fetch all officers with emails
      const officersSnapshot = await db.collection('officers').get();
      const officers = officersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      
      const notificationsToSend: { email: string, name: string, matches: any[] }[] = [];

      // 2. Matching logic for each officer
      officers.forEach(officer => {
        if (!officer.email) return;

        const personalMatches: any[] = [];
        const keywords = officer.keywords || [];
        const identifiers = [officer.registration, officer.name].filter(Boolean);

        fullText.forEach((pageData: any) => {
          const text = pageData.text;
          const textNormalized = normalizeText(text);
          const textFuzzy = normalizeTextFuzzy(text);

          // Check keywords
          keywords.forEach((kw: string) => {
            if (!kw) return;
            const kwNormalized = normalizeText(kw);
            const kwFuzzy = normalizeTextFuzzy(kw);
            if (textNormalized.includes(kwNormalized) || (kwFuzzy.length > 4 && textFuzzy.includes(kwFuzzy))) {
              personalMatches.push({ match: kw, type: 'Palavra-chave', page: pageData.page });
            }
          });

          // Check identifiers
          identifiers.forEach((id: string) => {
            if (!id) return;
            const idNormalized = normalizeText(id);
            const idFuzzy = normalizeTextFuzzy(id);
            if (textNormalized.includes(idNormalized) || (idFuzzy.length > 4 && textFuzzy.includes(idFuzzy))) {
              personalMatches.push({ match: id, type: 'Identificação', page: pageData.page });
            }
          });
        });

        if (personalMatches.length > 0) {
          notificationsToSend.push({
            email: officer.email,
            name: officer.name,
            matches: personalMatches
          });
        }
      });

      // 3. Send emails via Zoho
      if (notificationsToSend.length > 0) {
        // Log notification attempt
        try {
          await db.collection('system_logs').add({
            level: 'info',
            message: `Iniciando envio de ${notificationsToSend.length} notificações por e-mail.`,
            timestamp: new Date().toISOString(),
            details: { docType: docInfo.type, docNumber: docInfo.number }
          });
        } catch (e) { console.error("Log error:", e); }

        const transporter = nodemailer.createTransport({
          host: process.env.ZOHO_HOST || 'smtp.zoho.com',
          port: parseInt(process.env.ZOHO_PORT || '465'),
          secure: true, // true for 465, false for other ports
          auth: {
            user: process.env.ZOHO_USER,
            pass: process.env.ZOHO_PASS,
          },
        });

        const emailPromises = notificationsToSend.map(async (notif) => {
          const matchesList = notif.matches
            .map(m => `<li><b>${m.type}:</b> ${m.match} (Página ${m.page})</li>`)
            .join('');

          const mailOptions = {
            from: `"SIA-PMRN Alerta" <${process.env.ZOHO_USER}>`,
            to: notif.email,
            subject: `[ALERTA] Menção Identificada no ${docInfo.type} nº ${docInfo.number}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                <h2 style="color: #5A5A40;">Olá, ${notif.name}</h2>
                <p>Identificamos menções aos seus dados ou palavras-chave no <b>${docInfo.type} nº ${docInfo.number}</b> de ${docInfo.date}.</p>
                <p><b>Ocorrências encontradas:</b></p>
                <ul>${matchesList}</ul>
                <p>Acesse o sistema SIA-PMRN para conferir o detalhamento completo.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="font-size: 12px; color: #888;">Este é um aviso automático do Sistema de Inteligência e Análise do 5º BPM.</p>
              </div>
            `
          };

          return transporter.sendMail(mailOptions);
        });

        await Promise.all(emailPromises);

        // Log success
        try {
          await db.collection('system_logs').add({
            level: 'info',
            message: `Sucesso: ${notificationsToSend.length} e-mails enviados via Zoho.`,
            timestamp: new Date().toISOString()
          });
        } catch (e) { console.error("Log error:", e); }
      }

      res.json({ success: true, notifiedCount: notificationsToSend.length });
    } catch (error: any) {
      console.error("Notification Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/test-email", async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "E-mail de destino não informado." });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.ZOHO_HOST || 'smtp.zoho.com',
        port: parseInt(process.env.ZOHO_PORT || '465'),
        secure: true,
        auth: {
          user: process.env.ZOHO_USER,
          pass: process.env.ZOHO_PASS,
        },
      });

      await transporter.sendMail({
        from: `"SIA-PMRN Teste" <${process.env.ZOHO_USER}>`,
        to: email,
        subject: "[TESTE] Verificação de Configuração SMTP",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
            <h2 style="color: #5A5A40;">Teste de Conexão</h2>
            <p>Este é um e-mail de teste enviado para confirmar que as configurações do <b>Zoho Mail</b> estão funcionando corretamente no sistema SIA-PMRN.</p>
            <p>Se você recebeu este e-mail, a configuração está correta!</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #888;">Enviado em: ${new Date().toLocaleString('pt-BR')}</p>
          </div>
        `
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("SMTP Test Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route for system logs
  app.get("/api/logs", async (req, res) => {
    try {
      // In a real scenario, we'd check the user's token here.
      // For now, we'll rely on the frontend to only call this if they are the master admin.
      const logsSnapshot = await db.collection('system_logs')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();
      
      const logs = logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json({ success: true, logs });
    } catch (error: any) {
      console.error("Logs Fetch Error:", error);
      res.status(500).json({ error: error.message });
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
