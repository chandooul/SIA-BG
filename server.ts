import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import multer from 'multer';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  console.log(`Procurando configuração em: ${configPath}`);
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf8');
    firebaseConfig = JSON.parse(configContent);
    console.log("Configuração do Firebase carregada com sucesso do JSON.");
  } else {
    console.warn("Arquivo firebase-applet-config.json não encontrado no diretório atual.");
  }
} catch (e) {
  console.error("Erro ao carregar firebase-applet-config.json:", e);
}

const bucketName = process.env.STORAGE_BUCKET || firebaseConfig.storageBucket || 'my-project-1571939616356.firebasestorage.app';
const databaseId = firebaseConfig.firestoreDatabaseId || 'ai-studio-b6ea6f13-4814-4860-b01e-8fdbf28f2cb0';

console.log(`Configuração Inicial: Bucket=${bucketName}, Database=${databaseId}`);

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: bucketName
    });
    console.log("Firebase Admin inicializado com Service Account.");
  } catch (e) {
    console.error("Falha ao analisar FIREBASE_SERVICE_ACCOUNT:", e);
  }
} else {
  console.warn("FIREBASE_SERVICE_ACCOUNT não encontrada. Usando credenciais padrão.");
  try {
    admin.initializeApp({
      storageBucket: bucketName
    });
    console.log("Firebase Admin inicializado com credenciais padrão.");
  } catch (e) {
    console.warn("Falha na inicialização padrão do Firebase Admin:", e);
  }
}

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
    .replace(/[^a-z0-9]/g, '')       // Remove EVERYTHING except letters and numbers
    .replace(/z/g, "s");             // Normalize 'z' to 's' for names like Luiz/Luis
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  try {
    // Ensure uploads directory exists
    if (!fs.existsSync(path.join(process.cwd(), 'uploads'))) {
      fs.mkdirSync(path.join(process.cwd(), 'uploads'), { recursive: true });
    }

    app.use(express.json({ limit: '50mb' }));

    // Initialize Firestore with the specific database ID from config
    console.log(`Usando Database ID: ${databaseId} e Bucket: ${bucketName}`);
    
    const db = getFirestore(admin.app(), databaseId);

    // Test Firestore connection
    try {
      await db.collection('officers').limit(1).get();
      console.log("Conexão com Firestore (officers) estabelecida com sucesso.");
    } catch (dbErr) {
      console.error("Erro ao conectar ao Firestore:", dbErr);
    }

    const upload = multer({ dest: 'uploads/' });

  // API Route for file upload to Firebase Storage
  app.post("/api/upload", upload.single('file'), async (req: any, res: any) => {
    console.log('Recebida requisição POST em /api/upload');
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado." });
      }

      let bucket = admin.storage().bucket();
      
      // Check if bucket exists and try fallback if not
      try {
        const [exists] = await bucket.exists();
        if (!exists) {
          console.warn(`O bucket '${bucket.name}' não foi encontrado. Tentando fallbacks...`);
          const fallbacks = [
            `${firebaseConfig.projectId}.appspot.com`,
            `${firebaseConfig.projectId}.firebasestorage.app`,
            firebaseConfig.projectId,
            'ais-us-east1-1f7da320b8ad4f71a.appspot.com',
            'my-project-1571939616356.appspot.com'
          ];
          
          for (const fallbackName of fallbacks) {
            if (fallbackName === bucket.name) continue;
            const fallbackBucket = admin.storage().bucket(fallbackName);
            try {
              const [fExists] = await fallbackBucket.exists();
              if (fExists) {
                bucket = fallbackBucket;
                console.log(`Usando bucket de fallback: ${bucket.name}`);
                break;
              }
            } catch (e) {
              console.log(`Falha ao testar fallback ${fallbackName}: ${e.message}`);
            }
          }
        }
      } catch (err: any) {
        console.error("Erro ao verificar existência do bucket:", err);
      }

      const destination = `bg_files/${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      
      console.log(`Iniciando upload via Admin SDK. Bucket FINAL: ${bucket.name}, Destino: ${destination}`);

      let publicUrl = `https://storage.googleapis.com/${bucket.name}/${destination}`;
      let uploadSuccess = false;

      try {
        await bucket.upload(req.file.path, {
          destination,
          public: true,
          metadata: {
            contentType: req.file.mimetype,
          }
        });
        uploadSuccess = true;
        console.log(`Upload para Storage concluído com sucesso. URL: ${publicUrl}`);
        // Clean up local file after successful upload
        fs.unlinkSync(req.file.path);
      } catch (err: any) {
        console.error("Erro no bucket.upload, usando fallback local:", err.message);
        // Fallback: move file to a permanent local location and return local URL
        const localFileName = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const localPath = path.join(process.cwd(), 'uploads', localFileName);
        
        if (!fs.existsSync(path.join(process.cwd(), 'uploads'))) {
          fs.mkdirSync(path.join(process.cwd(), 'uploads'), { recursive: true });
        }
        
        fs.renameSync(req.file.path, localPath);
        publicUrl = `/uploads/${localFileName}`;
        console.log(`Fallback local ativado. URL: ${publicUrl}`);
      }

      res.json({ success: true, url: publicUrl, storageError: !uploadSuccess });
    } catch (error: any) {
      console.error("Upload Error:", error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: error.message });
    }
  });

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
        const personalMatches: any[] = [];
        const keywords = officer.keywords || [];
        const identifiers = [officer.registration, officer.name].filter(Boolean);
        const unit = officer.unit || '';

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

          // Check unit (if name or reg matches nearby or just as an identifier)
          if (unit) {
            const unitNormalized = normalizeText(unit);
            const unitFuzzy = normalizeTextFuzzy(unit);
            // We only count unit match if it's specific enough or combined with something else
            // but the user said "isolatedly", so let's be careful. 
            // Usually unit is not enough to identify a person, but we can add it to matches if found.
            if (textNormalized.includes(unitNormalized) || (unitFuzzy.length > 5 && textFuzzy.includes(unitFuzzy))) {
              // Only add unit match if we have at least one other match for this officer on this page
              // to avoid false positives (everyone in the same unit getting notified)
              if (personalMatches.some(m => m.page === pageData.page)) {
                personalMatches.push({ match: unit, type: 'Unidade', page: pageData.page });
              }
            }
          }
        });

        if (personalMatches.length > 0 && officer.email) {
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

  // Serve uploads directory locally as fallback
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));

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

  // Global error handler for API routes
  app.use((err: any, req: any, res: any, next: any) => {
    if (req.path.startsWith('/api')) {
      console.error('API Error:', err);
      return res.status(err.status || 500).json({ 
        error: err.message || 'Internal Server Error',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
    next(err);
  });
  } catch (err) {
    console.error("FATAL SERVER ERROR:", err);
    // Even if there's an error, we want to try and listen so the proxy doesn't time out
    // and we can potentially see the error in logs
    const fallbackApp = express();
    fallbackApp.all('*', (req, res) => {
      const message = `Server failed to start: ${err instanceof Error ? err.message : String(err)}`;
      if (req.path.startsWith('/api')) {
        return res.status(500).json({ error: message });
      }
      res.status(500).send(message);
    });
    fallbackApp.listen(PORT, "0.0.0.0");
  }
}

startServer();
