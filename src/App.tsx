/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileText, 
  Upload, 
  Search, 
  Users, 
  Building2, 
  Settings, 
  LogOut, 
  LogIn, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  ChevronRight,
  Download,
  Filter,
  FileSpreadsheet,
  Globe,
  Tag,
  X,
  Menu,
  User as UserIcon,
  Key,
  ShieldCheck,
  ExternalLink,
  FileSearch,
  ArrowLeft
} from 'lucide-react';
import { 
  auth, 
  db, 
  storage,
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  googleProvider, 
  OperationType, 
  handleFirestoreError,
  signInAnonymously
} from './firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User,
  GoogleAuthProvider,
  browserPopupRedirectResolver
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  getDocs, 
  getDoc,
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  onSnapshot,
  where,
  setDoc
} from 'firebase/firestore';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// PDF.js worker setup - using local worker bundled by Vite for maximum reliability
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Officer {
  id: string;
  name: string;
  registration: string;
  unit: string;
  rank?: string;
  password?: string;
  email?: string;
  phone?: string;
  isFirstAccess?: boolean;
  keywords?: string[];
  role?: 'admin' | 'user';
}

interface Unit {
  id: string;
  name: string;
  acronym?: string;
}

interface SearchTerm {
  id: string;
  term: string;
  category?: string;
}

interface AuthorizedAdmin {
  id: string;
  email: string;
  addedAt: string;
}

interface IdentificationResult {
  type: 'officer' | 'unit' | 'term';
  match: string;
  context: string;
  page: number;
  metadata?: any;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loggedInOfficer, setLoggedInOfficer] = useState<Officer | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showProfileUpdate, setShowProfileUpdate] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [detailView, setDetailView] = useState<{
    docType: 'BG' | 'ADITAMENTO';
    category: 'officer' | 'unit' | 'term';
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'database' | 'settings' | 'keywords'>('dashboard');
  const [dbTab, setDbTab] = useState<'officers' | 'units' | 'terms' | 'admins'>('officers');
  
  // Database State
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([]);
  const [authorizedAdmins, setAuthorizedAdmins] = useState<AuthorizedAdmin[]>([]);
  
  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingMessage, setProcessingMessage] = useState('Analisando documento...');
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null); // Current processing URL
  
  // BG Analysis State
  const [bgResults, setBgResults] = useState<IdentificationResult[]>([]);
  const [bgFullText, setBgFullText] = useState<{page: number, text: string}[]>([]);
  const [bgFileName, setBgFileName] = useState<string | null>(null);
  const [bgUploadedAt, setBgUploadedAt] = useState<string | null>(null);
  const [bgNumber, setBgNumber] = useState<string>('');
  const [bgDate, setBgDate] = useState<string>('');
  const [bgPdfUrl, setBgPdfUrl] = useState<string | null>(null);

  // Aditamento Analysis State
  const [aditamentoResults, setAditamentoResults] = useState<IdentificationResult[]>([]);
  const [aditamentoFullText, setAditamentoFullText] = useState<{page: number, text: string}[]>([]);
  const [aditamentoFileName, setAditamentoFileName] = useState<string | null>(null);
  const [aditamentoUploadedAt, setAditamentoUploadedAt] = useState<string | null>(null);
  const [aditamentoNumber, setAditamentoNumber] = useState<string>('');
  const [aditamentoDate, setAditamentoDate] = useState<string>('');
  const [aditamentoPdfUrl, setAditamentoPdfUrl] = useState<string | null>(null);

  const [userSpecificResults, setUserSpecificResults] = useState<any[]>([]);
  const [uploadDocType, setUploadDocType] = useState<'BG' | 'ADITAMENTO'>('BG');
  const [uploadBgNumber, setUploadBgNumber] = useState<string>('');
  const [uploadBgDate, setUploadBgDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Form States
  const [newOfficer, setNewOfficer] = useState({ name: '', registration: '', unit: '', rank: '', role: 'user' as 'admin' | 'user' });
  const [newUnit, setNewUnit] = useState({ name: '', acronym: '' });
  const [newTerm, setNewTerm] = useState({ term: '', category: '' });
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    // Check for saved officer session
    const savedOfficer = localStorage.getItem('officer_session');
    if (savedOfficer) {
      try {
        const parsed = JSON.parse(savedOfficer);
        setLoggedInOfficer(parsed);
      } catch (e) {
        localStorage.removeItem('officer_session');
      }
    }

    return unsubscribe;
  }, [activeTab]);

  // Firestore Listeners
  useEffect(() => {
    console.log('Initializing Firestore listeners...');
    // Listeners now work for everyone (public read)
    const unsubOfficers = onSnapshot(collection(db, 'officers'), (snapshot) => {
      console.log(`Loaded ${snapshot.docs.length} officers`);
      setOfficers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Officer)));
    }, (err) => {
      console.error('Error fetching officers:', err);
      toast.error('Erro ao carregar dados dos policiais. Verifique sua conexão.');
    });

    const unsubUnits = onSnapshot(collection(db, 'units'), (snapshot) => {
      console.log(`Loaded ${snapshot.docs.length} units`);
      setUnits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unit)));
    }, (err) => console.error('Error fetching units:', err));

    const unsubTerms = onSnapshot(collection(db, 'searchTerms'), (snapshot) => {
      console.log(`Loaded ${snapshot.docs.length} search terms`);
      setSearchTerms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SearchTerm)));
    }, (err) => console.error('Error fetching terms:', err));

    const unsubBG = onSnapshot(doc(db, 'bg_analysis', 'latest_bg'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setBgResults(data.results || []);
        setBgFullText(data.fullText || []);
        setBgFileName(data.fileName || null);
        setBgPdfUrl(data.pdfUrl || null);
        setBgUploadedAt(data.uploadedAt || null);
        setBgNumber(data.bgNumber || '');
        setBgDate(data.bgDate || '');
        console.log('Latest BG analysis loaded from Firestore');
      }
    }, (err) => {
      console.error('Error fetching latest BG:', err);
      handleFirestoreError(err, OperationType.GET, 'bg_analysis/latest_bg');
    });

    const unsubAditamento = onSnapshot(doc(db, 'bg_analysis', 'latest_aditamento'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setAditamentoResults(data.results || []);
        setAditamentoFullText(data.fullText || []);
        setAditamentoFileName(data.fileName || null);
        setAditamentoPdfUrl(data.pdfUrl || null);
        setAditamentoUploadedAt(data.uploadedAt || null);
        setAditamentoNumber(data.bgNumber || '');
        setAditamentoDate(data.bgDate || '');
        console.log('Latest Aditamento analysis loaded from Firestore');
      }
    }, (err) => {
      console.error('Error fetching latest Aditamento:', err);
      handleFirestoreError(err, OperationType.GET, 'bg_analysis/latest_aditamento');
    });

    return () => {
      unsubOfficers();
      unsubUnits();
      unsubTerms();
      unsubBG();
      unsubAditamento();
    };
  }, []);

  // Admin Listener - reacts to user login
  useEffect(() => {
    if (!user) {
      setAuthorizedAdmins([]);
      return;
    }

    const unsubAdmins = onSnapshot(collection(db, 'authorized_admins'), (snapshot) => {
      setAuthorizedAdmins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuthorizedAdmin)));
    }, (err) => {
      console.error('Error fetching authorized admins:', err);
      // If permission denied, it just means they aren't an admin, so we keep the list empty
      setAuthorizedAdmins([]);
    });

    return () => unsubAdmins();
  }, [user]);

  const ADMIN_EMAIL = "chandooul@gmail.com";

  const isAuthorizedAdmin = (user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) || 
                            authorizedAdmins.some(a => a.email.toLowerCase() === user?.email?.toLowerCase());
  const isAdmin = isAuthorizedAdmin || loggedInOfficer?.role === 'admin';

  useEffect(() => {
    if (!loading && !isAdmin && (activeTab === 'database' || activeTab === 'settings')) {
      setActiveTab('dashboard');
    }
  }, [isAdmin, activeTab, loading]);

  const handleLogin = async () => {
    console.log('Login button clicked, initiating Google Auth...');
    
    // Create a fresh provider instance
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    
    try {
      // Use browserPopupRedirectResolver to help with iframe/popup communication issues
      const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      
      setIsLoggingIn(true);
      const loggedUser = result.user;
      const email = loggedUser.email?.toLowerCase() || '';
      console.log('Login successful for:', email);
      
      let isAuthorized = email === ADMIN_EMAIL.toLowerCase();
      
      if (!isAuthorized) {
        // Direct check in Firestore to avoid stale state issues during login
        try {
          const adminDoc = await getDoc(doc(db, 'authorized_admins', email));
          if (adminDoc.exists()) {
            isAuthorized = true;
          }
        } catch (err) {
          console.error('Error checking authorization document:', err);
        }
      }
      
      if (!isAuthorized) {
        console.warn('User is not an authorized administrator:', email);
        toast.error('Acesso negado. Esta conta Gmail não possui privilégios administrativos.');
        await signOut(auth);
      } else {
        toast.success('Acesso administrativo concedido!');
      }
    } catch (error: any) {
      console.error('Login error details:', error);
      const errorCode = error.code;
      
      if (errorCode === 'auth/popup-blocked') {
        toast.error('O popup de login foi bloqueado. Por favor, permita popups para este site nas configurações do seu navegador.');
      } else if (errorCode === 'auth/cancelled-popup-request' || errorCode === 'auth/popup-closed-by-user') {
        toast.error('A janela de login foi fechada antes da conclusão.');
      } else if (errorCode === 'auth/unauthorized-domain') {
        toast.error('ERRO CRÍTICO: Domínio não autorizado. Você precisa adicionar este endereço nas configurações do Firebase Console (Authentication > Settings > Authorized domains).');
      } else if (errorCode === 'auth/network-request-failed') {
        toast.error('Erro de rede. Verifique sua conexão ou se há um Firewall/AdBlock bloqueando o Firebase.');
      } else if (errorCode === 'auth/operation-not-allowed') {
        toast.error('O login via Google não está ativado no seu projeto Firebase.');
      } else {
        toast.error(`Erro no login (${errorCode}): ${error.message}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (user) {
        await signOut(auth);
      }
      if (loggedInOfficer) {
        setLoggedInOfficer(null);
        localStorage.removeItem('officer_session');
      }
      toast.success('Sessão encerrada.');
    } catch (error) {
      console.error(error);
    }
  };

  const handleOfficerLogin = async (registration: string, passwordInput: string) => {
    try {
      const q = query(collection(db, 'officers'), where('registration', '==', registration));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        toast.error('Matrícula não encontrada no banco de dados.');
        return;
      }

      const officerDoc = snapshot.docs[0];
      const officerData = { id: officerDoc.id, ...officerDoc.data() } as Officer;

      // Check password (if not set, use registration as default)
      const correctPassword = officerData.password || officerData.registration;
      
      if (passwordInput === correctPassword) {
        try {
          // Try to sign in anonymously to Firebase to gain "Authenticated" status in rules
          const authResult = await signInAnonymously(auth);
          
          // Cache the role in the 'users' collection for the security rules
          await setDoc(doc(db, 'users', authResult.user.uid), { 
            role: officerData.role || 'user',
            officerId: officerData.id,
            registration: officerData.registration
          });
        } catch (authErr: any) {
          console.warn('Firebase Auth failed:', authErr);
          if (authErr.code === 'auth/admin-restricted-operation') {
            toast.error('Atenção: O login anônimo está desativado no Firebase. Algumas funções administrativas e de troca de senha podem não funcionar.', { duration: 6000 });
          }
        }

        setLoggedInOfficer(officerData);
        localStorage.setItem('officer_session', JSON.stringify(officerData));
        toast.success(`Bem-vindo, ${officerData.name}!`);

        // Check if email or phone is missing for common users
        if (officerData.role !== 'admin' && (!officerData.email || !officerData.phone)) {
          setShowProfileUpdate(true);
        }
      } else {
        toast.error('Senha incorreta.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao realizar login.');
    }
  };

  const handlePasswordChange = async (newPassword: string) => {
    if (!loggedInOfficer) return;
    
    try {
      const officerRef = doc(db, 'officers', loggedInOfficer.id);
      await setDoc(officerRef, { 
        ...loggedInOfficer, 
        password: newPassword, 
        isFirstAccess: false 
      }, { merge: true });
      
      const updatedOfficer = { ...loggedInOfficer, password: newPassword, isFirstAccess: false };
      setLoggedInOfficer(updatedOfficer);
      localStorage.setItem('officer_session', JSON.stringify(updatedOfficer));
      setShowChangePassword(false);
      toast.success('Senha alterada com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao alterar senha.');
    }
  };

  const handleProfileUpdate = async (email: string, phone: string) => {
    if (!loggedInOfficer) return;
    
    try {
      const officerRef = doc(db, 'officers', loggedInOfficer.id);
      await setDoc(officerRef, { 
        ...loggedInOfficer, 
        email, 
        phone 
      }, { merge: true });
      
      const updatedOfficer = { ...loggedInOfficer, email, phone };
      setLoggedInOfficer(updatedOfficer);
      localStorage.setItem('officer_session', JSON.stringify(updatedOfficer));
      setShowProfileUpdate(false);
      toast.success('Dados cadastrais atualizados com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao atualizar dados cadastrais.');
    }
  };

  const updateKeywords = async (keywords: string[]) => {
    if (!loggedInOfficer) return;
    
    try {
      const officerRef = doc(db, 'officers', loggedInOfficer.id);
      await setDoc(officerRef, { keywords }, { merge: true });
      
      const updatedOfficer = { ...loggedInOfficer, keywords };
      setLoggedInOfficer(updatedOfficer);
      localStorage.setItem('officer_session', JSON.stringify(updatedOfficer));
      toast.success('Palavras-chave atualizadas!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao atualizar palavras-chave.');
    }
  };

  // Database Actions
  const addOfficer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const officerData = { 
        ...newOfficer, 
        password: newOfficer.registration, 
        isFirstAccess: true,
        keywords: [] 
      };
      await addDoc(collection(db, 'officers'), officerData);
      setNewOfficer({ name: '', registration: '', unit: '', rank: '', role: 'user' });
      toast.success('Policial adicionado! Senha inicial é a matrícula.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'officers');
    }
  };

  const addUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'units'), newUnit);
      setNewUnit({ name: '', acronym: '' });
      toast.success('Unidade adicionada!');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'units');
    }
  };

  const addTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'searchTerms'), newTerm);
      setNewTerm({ term: '', category: '' });
      toast.success('Termo adicionado!');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'searchTerms');
    }
  };

  const addAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailToAuthorize = newAdminEmail.toLowerCase().trim();
    
    if (!emailToAuthorize.includes('@gmail.com')) {
      toast.error('Por favor, insira um e-mail válido do Gmail.');
      return;
    }
    if (authorizedAdmins.some(a => a.email.toLowerCase() === emailToAuthorize)) {
      toast.error('Este e-mail já está cadastrado como administrador.');
      return;
    }
    try {
      await setDoc(doc(db, 'authorized_admins', emailToAuthorize), {
        email: emailToAuthorize,
        addedAt: new Date().toISOString()
      });
      setNewAdminEmail('');
      toast.success('Administrador autorizado com sucesso!');
    } catch (err) {
      console.error('Erro ao adicionar administrador:', err);
      toast.error('Erro ao autorizar administrador. Verifique suas permissões.');
      handleFirestoreError(err, OperationType.CREATE, 'authorized_admins');
    }
  };

  const removeAdmin = async (id: string, email: string) => {
    if (email === ADMIN_EMAIL) {
      toast.error('O administrador mestre não pode ser removido.');
      return;
    }
    if (!confirm(`Deseja remover o acesso administrativo de ${email}?`)) return;
    try {
      await deleteDoc(doc(db, 'authorized_admins', id));
      toast.success('Administrador removido.');
    } catch (err) {
      console.error('Erro ao remover administrador:', err);
      toast.error('Erro ao remover administrador.');
      handleFirestoreError(err, OperationType.DELETE, `authorized_admins/${id}`);
    }
  };

  const deleteItem = async (col: string, id: string) => {
    try {
      await deleteDoc(doc(db, col, id));
      toast.success('Item removido.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, col);
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsBulkUploading(true);
    const toastId = toast.loading('Substituindo dados e processando planilha...');

    try {
      // 1. Delete existing officers (Replacement logic)
      const snapshot = await getDocs(collection(db, 'officers'));
      const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, 'officers', d.id)));
      await Promise.all(deletePromises);

      // 2. Process new data
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

      let successCount = 0;
      let errorCount = 0;

      for (const row of jsonData) {
        // Map common column names
        const officerData = {
          name: row.Nome || row.nome || row.NAME || row.name || '',
          registration: String(row.Matricula || row.matricula || row.REGISTRATION || row.registration || ''),
          unit: row.Unidade || row.unidade || row.UNIT || row.unit || '',
          rank: row.Posto || row.Graduacao || row.rank || ''
        };

        if (officerData.name && officerData.registration && officerData.unit) {
          try {
            await addDoc(collection(db, 'officers'), {
              ...officerData,
              password: officerData.registration,
              isFirstAccess: true,
              keywords: [],
              role: 'user'
            });
            successCount++;
          } catch (err) {
            errorCount++;
          }
        } else {
          errorCount++;
        }
      }

      toast.success(`${successCount} policiais importados. Banco de dados atualizado!`, { id: toastId });
      if (errorCount > 0) {
        toast.error(`${errorCount} registros ignorados por falta de dados obrigatórios.`);
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao atualizar banco de dados. Verifique o formato.', { id: toastId });
    } finally {
      setIsBulkUploading(false);
      e.target.value = ''; // Reset input
    }
  };

  // Helper for flexible matching
  const normalizeText = (text: string) => {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[º°ª]/g, " ")          // Replace ordinal/degree/feminine ordinal with space
      .replace(/(\d+)\s*[o\.]\s*/g, "$1 ") // Replace "5 o" or "5." with "5 "
      .replace(/\s+/g, ' ')           // Simplify whitespace
      .trim();
  };

  const normalizeTextFuzzy = (text: string) => {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[º°ª\.]/g, "")         // Remove ordinal/degree/dots
      .replace(/\s+/g, '')            // Remove ALL whitespace
      .trim();
  };

  const getRegistrationVariations = (reg: string) => {
    const nums = reg.replace(/\D/g, '');
    if (!nums) return [reg.toLowerCase()];
    const variations = new Set([reg.toLowerCase(), nums]);
    if (nums.length >= 6) {
      variations.add(`${nums.substring(0, nums.length - 1)}-${nums.substring(nums.length - 1)}`);
    }
    return Array.from(variations);
  };

  const getUnitVariations = (unit: string) => {
    const normalized = unit.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[º°ª]/g, " ");
    const numMatch = normalized.match(/(\d+)/);
    if (!numMatch) return [unit.toLowerCase(), normalizeText(unit)];
    
    const n = numMatch[1];
    const variations = new Set([
      unit.toLowerCase(),
      normalizeText(unit),
      `${n}bpm`,
      `${n} bpm`,
      `${n} batalhao`,
      `${n} batalhão`,
      `${n}bt`,
      `${n} bt`
    ]);
    return Array.from(variations);
  };

  // PDF Processing
  // Client-side search for user-specific keywords and identifiers
  useEffect(() => {
    if (!loggedInOfficer) {
      setUserSpecificResults([]);
      return;
    }

    const personalResults: any[] = [];
    const combinedResults = [...bgResults, ...aditamentoResults];
    const combinedFullText = [...bgFullText, ...aditamentoFullText];
    
    // 1. Check global results for matches with current user (Cross-referencing)
    combinedResults.forEach(res => {
      if (res.type === 'officer' && res.metadata) {
        const isMatch = res.metadata.registration === loggedInOfficer.registration || 
                        res.metadata.name === loggedInOfficer.name;
        if (isMatch) {
          personalResults.push({
            ...res,
            label: 'Identificado via Banco de Dados'
          });
        }
      }
      if (res.type === 'unit' && res.match === loggedInOfficer.unit) {
        personalResults.push({
          ...res,
          label: 'Sua Unidade Identificada'
        });
      }
    });

    // 2. Search fullText for keywords (to catch things not in global results or newly added)
    if (combinedFullText.length) {
      const keywords = loggedInOfficer.keywords || [];
      const identifiers = [
        loggedInOfficer.registration,
        loggedInOfficer.name
      ].filter(Boolean);

      combinedFullText.forEach(pageData => {
        const text = pageData.text;
        const textNormalized = normalizeText(text);
        const textFuzzy = normalizeTextFuzzy(text);

        // Search for keywords
        keywords.forEach(kw => {
          if (!kw) return;
          const kwNormalized = normalizeText(kw);
          const kwFuzzy = normalizeTextFuzzy(kw);
          
          const hasMatch = textNormalized.includes(kwNormalized) || 
                          (kwFuzzy.length > 4 && textFuzzy.includes(kwFuzzy));

          if (hasMatch) {
            const index = textNormalized.indexOf(kwNormalized);
            const start = Math.max(0, index - 60);
            const end = Math.min(text.length, index + kw.length + 80);
            const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
            
            personalResults.push({
              type: 'personal',
              match: kw,
              context: context ? `...${context}...` : 'Menção encontrada no texto.',
              page: pageData.page,
              label: 'Palavra-chave Pessoal'
            });
          }
        });

        // Search for name and registration (if not already found in global results)
        identifiers.forEach(id => {
          if (!id) return;
          const idNormalized = normalizeText(id);
          const idFuzzy = normalizeTextFuzzy(id);
          
          const hasMatch = textNormalized.includes(idNormalized) || 
                          (idFuzzy.length > 4 && textFuzzy.includes(idFuzzy));

          if (hasMatch) {
            const index = textNormalized.indexOf(idNormalized);
            const start = Math.max(0, index - 60);
            const end = Math.min(text.length, index + id.length + 80);
            const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
            
            personalResults.push({
              type: 'identity',
              match: id,
              context: context ? `...${context}...` : 'Menção encontrada no texto.',
              page: pageData.page,
              label: id === loggedInOfficer.registration ? 'Sua Matrícula' : 'Seu Nome'
            });
          }
        });
      });
    }

    // Remove duplicates (if something was found in both global results and keywords)
    const uniqueResults = personalResults.filter((res, index, self) =>
      index === self.findIndex((t) => (
        t.match === res.match && t.page === res.page && t.context === res.context
      ))
    );

    setUserSpecificResults(uniqueResults);
  }, [bgResults, aditamentoResults, bgFullText, aditamentoFullText, loggedInOfficer?.keywords, loggedInOfficer?.registration, loggedInOfficer?.name, loggedInOfficer?.unit]);

  const processPDF = async (data: ArrayBuffer, name: string, append = false) => {
    console.log('Starting PDF processing for:', name);
    
    setIsProcessing(true);
    setProcessingMessage('Iniciando processamento...');
    
    const currentDocType = uploadDocType;
    const currentResults = currentDocType === 'BG' ? bgResults : aditamentoResults;
    const currentFullText = currentDocType === 'BG' ? bgFullText : aditamentoFullText;
    const currentFileName = currentDocType === 'BG' ? bgFileName : aditamentoFileName;
    const currentPdfUrl = currentDocType === 'BG' ? bgPdfUrl : aditamentoPdfUrl;

    if (!append) {
      if (currentDocType === 'BG') {
        setBgResults([]);
        setBgFullText([]);
        setBgFileName(name);
      } else {
        setAditamentoResults([]);
        setAditamentoFullText([]);
        setAditamentoFileName(name);
      }
    } else {
      if (currentDocType === 'BG') {
        setBgFileName(prev => prev ? `${prev} + ${name}` : name);
      } else {
        setAditamentoFileName(prev => prev ? `${prev} + ${name}` : name);
      }
    }

    setProgress(0);

    try {
      console.log(`Data size: ${data.byteLength} bytes`);
      const blob = new Blob([data], { type: 'application/pdf' });
      console.log(`Blob created: ${blob.size} bytes, type: ${blob.type}`);
      setPdfBlob(blob);
      
      // Delete previous file if it exists and we're not appending
      if (currentPdfUrl && !append) {
        setProcessingMessage('Limpando arquivos antigos...');
        try {
          // Only try to delete if the URL looks like it belongs to our storage
          if (currentPdfUrl.includes('firebasestorage.googleapis.com')) {
            const oldFileRef = ref(storage, currentPdfUrl);
            await deleteObject(oldFileRef);
            console.log('Previous PDF deleted from Storage');
          }
        } catch (deleteError) {
          console.warn('Could not delete previous PDF:', deleteError);
        }
      }

      // Upload to Firebase Storage
      console.log('Uploading PDF to Storage...');
      setProcessingMessage('Iniciando envio...');
      setProgress(10); 
      
      let downloadUrl = '';
      const sanitizedName = `${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      
      try {
        const storageRef = ref(storage, `bg_files/${sanitizedName}`);
        console.log('Storage reference created:', storageRef.fullPath);
        
        // Use uploadBytesResumable for better progress tracking and timeout handling
        const uploadTask = uploadBytesResumable(storageRef, blob);
        
        const uploadPromise = new Promise<string>((resolve, reject) => {
          let lastBytes = 0;
          let lastUpdate = Date.now();
          
          const timeout = setTimeout(() => {
            console.error('Upload timeout reached');
            uploadTask.cancel();
            reject(new Error('timeout'));
          }, 300000); // 5 minutes timeout

          const stuckCheck = setInterval(() => {
            if (Date.now() - lastUpdate > 45000 && lastBytes === 0) {
              console.warn('Upload seems stuck at 0%');
              clearInterval(stuckCheck);
              uploadTask.cancel();
              reject(new Error('stuck'));
            }
          }, 5000);

          uploadTask.on('state_changed', 
            (snapshot) => {
              const total = snapshot.totalBytes || 1;
              const transferred = snapshot.bytesTransferred;
              
              if (transferred > lastBytes) {
                lastBytes = transferred;
                lastUpdate = Date.now();
              }
              
              const uploadProgress = (transferred / total) * 30; // 0 to 30%
              const currentProgress = Math.round(10 + uploadProgress);
              const percent = Math.round((transferred / total) * 100);
              
              setProgress(currentProgress);
              setProcessingMessage(`Enviando: ${percent}%`);
              console.log(`Upload progress: ${percent}% (${transferred}/${total} bytes) - State: ${snapshot.state}`);
            }, 
            (error: any) => {
              clearTimeout(timeout);
              clearInterval(stuckCheck);
              if (error.code !== 'storage/canceled') {
                console.error('Upload task error:', error);
              }
              reject(error);
            }, 
            async () => {
              console.log('Upload task completed successfully');
              clearTimeout(timeout);
              clearInterval(stuckCheck);
              try {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(url);
              } catch (urlErr) {
                console.error('Error getting download URL:', urlErr);
                reject(urlErr);
              }
            }
          );
        });

        downloadUrl = await uploadPromise;
        console.log('PDF uploaded successfully');
        setPdfUrl(downloadUrl);
      } catch (storageErr: any) {
        if (storageErr.code !== 'storage/canceled' && storageErr.message !== 'stuck' && storageErr.message !== 'timeout') {
          console.error('Storage Upload Error:', storageErr);
        }
        // Fallback to local URL for immediate analysis
        downloadUrl = URL.createObjectURL(blob);
        setPdfUrl(downloadUrl);
        
        if (storageErr.message === 'timeout') {
          toast.warning('O upload demorou muito. O arquivo será analisado localmente, mas não ficará salvo permanentemente.');
        } else if (storageErr.message === 'stuck') {
          toast.warning('O envio ao servidor está lento. Prosseguindo com análise local para agilizar...');
        } else if (storageErr.code === 'storage/unauthorized') {
          toast.error('Sem permissão para salvar no Storage. Verifique as regras de segurança no Console Firebase.');
        } else if (storageErr.code !== 'storage/canceled') {
          toast.warning('Falha ao salvar arquivo no servidor. Analisando cópia local...');
        }
      }
      
      setProgress(40);

      console.log('Initializing PDF.js...');
      setProcessingMessage('Carregando motor de análise (PDF.js)...');
      const pdf = await pdfjsLib.getDocument({ 
        data,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/cmaps/',
        cMapPacked: true,
      }).promise;
      const numPages = pdf.numPages;
      console.log(`PDF loaded with ${numPages} pages`);
      const found: IdentificationResult[] = [];
      const pagesText: {page: number, text: string}[] = [];

      setProcessingMessage(`Analisando ${numPages} páginas...`);
      
      for (let i = 1; i <= numPages; i++) {
        try {
          // Yield to main thread to keep UI responsive
          await new Promise(resolve => setTimeout(resolve, 0));
          
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const text = textContent.items.map((item: any) => item.str).join(' ');
          const textNormalized = normalizeText(text);
          const textFuzzy = normalizeTextFuzzy(text);
          
          pagesText.push({ page: i, text });
          
          // Calculate progress from 40% to 100%
          const analysisProgress = Math.round(40 + (i / numPages) * 60);
          setProgress(analysisProgress);
          setProcessingMessage(`Analisando página ${i} de ${numPages}...`);

          // Search for Officers
          officers.forEach(off => {
            if (!off.name && !off.registration) return;
            
            const nameNormalized = normalizeText(off.name);
            const nameFuzzy = normalizeTextFuzzy(off.name);
            const regVariations = getRegistrationVariations(off.registration).map(v => normalizeText(v));
            const regFuzzy = normalizeTextFuzzy(off.registration);

            const nameMatch = (nameNormalized && textNormalized.includes(nameNormalized)) || 
                             (nameFuzzy.length > 5 && textFuzzy.includes(nameFuzzy));
            const regMatch = regVariations.find(v => textNormalized.includes(v)) || 
                            (regFuzzy.length > 4 && textFuzzy.includes(regFuzzy) ? regFuzzy : undefined);

            if (nameMatch || regMatch) {
              const matchStr = nameMatch ? nameNormalized : (typeof regMatch === 'string' ? regMatch : normalizeText(off.registration));
              const index = textNormalized.indexOf(matchStr);
              const start = Math.max(0, index - 60);
              const end = Math.min(text.length, index + matchStr.length + 80);
              const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
              
              found.push({
                type: 'officer',
                match: `${off.name} (${off.registration})`,
                context: context ? `...${context}...` : 'Identificado no texto.',
                page: i,
                metadata: off
              });
            }
          });

          // Search for Mandatory Terms (5º BPM) - Always included
          // 1. Regex-based search (most flexible)
          const battalionRegex = /(5|quinto|quinta)\s*[º°ªo\.]?\s*(bpm|batalhao|batalhão|bt)/gi;
          let bMatch;
          while ((bMatch = battalionRegex.exec(text)) !== null) {
            console.log('Battalion match found:', bMatch[0]);
            const index = bMatch.index;
            const matchText = bMatch[0];
            const start = Math.max(0, index - 60);
            const end = Math.min(text.length, index + matchText.length + 80);
            const context = text.substring(start, end).replace(/\s+/g, ' ').trim();

            if (!found.some(f => f.type === 'unit' && f.match === '5º BPM' && f.page === i)) {
              found.push({
                type: 'unit',
                match: '5º BPM',
                context: context ? `...${context}...` : 'Identificado no texto.',
                page: i,
                metadata: { name: '5º BPM', acronym: '5BPM' }
              });
            }
          }

          // 2. Variation-based search (fallback)
          const mandatoryUnitTerms = [
            { name: '5º BPM', acronym: '5BPM' },
            { name: '5º BATALHÃO', acronym: '5º BATALHÃO' },
            { name: '5º BATALHAO', acronym: '5º BATALHAO' }
          ];

          mandatoryUnitTerms.forEach(unit => {
            const unitVariations = getUnitVariations(unit.name).map(v => normalizeText(v));
            const unitFuzzy = normalizeTextFuzzy(unit.name);
            const acronymNormalized = normalizeText(unit.acronym);

            const unitMatch = unitVariations.find(v => textNormalized.includes(v)) || 
                             (unitFuzzy.length > 4 && textFuzzy.includes(unitFuzzy) ? unitFuzzy : undefined);
            const acronymMatch = acronymNormalized && textNormalized.includes(acronymNormalized);

            if (unitMatch || acronymMatch) {
              const matchStr = (typeof unitMatch === 'string' ? unitMatch : acronymNormalized);
              const index = textNormalized.indexOf(matchStr);
              const start = Math.max(0, index - 60);
              const end = Math.min(text.length, index + matchStr.length + 80);
              const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
              
              // Only add if not already found to avoid duplicates
              if (!found.some(f => f.type === 'unit' && f.match === '5º BPM' && f.page === i)) {
                found.push({
                  type: 'unit',
                  match: '5º BPM',
                  context: context ? `...${context}...` : 'Identificado no texto.',
                  page: i,
                  metadata: { name: '5º BPM', acronym: '5BPM' }
                });
              }
            }
          });

          // Search for Units
          units.forEach(unit => {
            if (!unit.name) return;
            
            const unitVariations = getUnitVariations(unit.name).map(v => normalizeText(v));
            const unitFuzzy = normalizeTextFuzzy(unit.name);
            const acronymNormalized = normalizeText(unit.acronym);

            const unitMatch = unitVariations.find(v => textNormalized.includes(v)) || 
                             (unitFuzzy.length > 4 && textFuzzy.includes(unitFuzzy) ? unitFuzzy : undefined);
            const acronymMatch = acronymNormalized && textNormalized.includes(acronymNormalized);

            if (unitMatch || acronymMatch) {
              const matchStr = (typeof unitMatch === 'string' ? unitMatch : acronymNormalized);
              const index = textNormalized.indexOf(matchStr);
              const start = Math.max(0, index - 60);
              const end = Math.min(text.length, index + matchStr.length + 80);
              const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
              
              found.push({
                type: 'unit',
                match: unit.name,
                context: context ? `...${context}...` : 'Identificado no texto.',
                page: i,
                metadata: unit
              });
            }
          });

          // Search for Custom Terms
          searchTerms.forEach(st => {
            if (!st.term) return;
            
            const termNormalized = normalizeText(st.term);
            const termFuzzy = normalizeTextFuzzy(st.term);
            
            const hasMatch = textNormalized.includes(termNormalized) || 
                            (termFuzzy.length > 4 && textFuzzy.includes(termFuzzy));

            if (hasMatch) {
              const index = textNormalized.indexOf(termNormalized);
              const start = Math.max(0, index - 60);
              const end = Math.min(text.length, index + st.term.length + 80);
              const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
              
              found.push({
                type: 'term',
                match: st.term,
                context: context ? `...${context}...` : 'Identificado no texto.',
                page: i,
                metadata: st
              });
            }
          });

          // Search for User Keywords
          if (loggedInOfficer?.keywords) {
            loggedInOfficer.keywords.forEach(kw => {
              if (!kw) return;
              const kwNormalized = normalizeText(kw);
              const kwFuzzy = normalizeTextFuzzy(kw);
              
              const hasMatch = textNormalized.includes(kwNormalized) || 
                              (kwFuzzy.length > 4 && textFuzzy.includes(kwFuzzy));

              if (hasMatch) {
                const index = textNormalized.indexOf(kwNormalized);
                const start = Math.max(0, index - 60);
                const end = Math.min(text.length, index + kw.length + 80);
                const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
                
                found.push({
                  type: 'term',
                  match: `Palavra-chave: ${kw}`,
                  context: context ? `...${context}...` : 'Identificado no texto.',
                  page: i,
                  metadata: { term: kw, category: 'Pessoal' }
                });
              }
            });
          }
        } catch (pageError) {
          console.error(`Erro ao processar página ${i}:`, pageError);
          continue;
        }
      }

      if (append) {
        const newResults = [...currentResults, ...found];
        const newFullText = [...currentFullText, ...pagesText];
        
        if (currentDocType === 'BG') {
          setBgResults(newResults);
          setBgFullText(newFullText);
          setBgPdfUrl(downloadUrl);
        } else {
          setAditamentoResults(newResults);
          setAditamentoFullText(newFullText);
          setAditamentoPdfUrl(downloadUrl);
        }

        // If admin, save to Firestore
        if (user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') {
          try {
            const docId = currentDocType === 'BG' ? 'latest_bg' : 'latest_aditamento';
            await setDoc(doc(db, 'bg_analysis', docId), {
              fileName: currentFileName ? `${currentFileName} + ${name}` : name,
              results: newResults,
              fullText: newFullText,
              pdfUrl: downloadUrl,
              uploadedAt: new Date().toISOString(),
              uploadedBy: user?.displayName || loggedInOfficer?.name || 'Administrador',
              docType: currentDocType,
              bgNumber: uploadBgNumber,
              bgDate: uploadBgDate
            });
            toast.success('Análise salva com sucesso no banco de dados!');
          } catch (error) {
            console.error('Erro ao salvar análise:', error);
            toast.error('O arquivo foi processado, mas não pôde ser salvo no banco de dados. Verifique suas permissões.');
          }
        }
      } else {
        if (currentDocType === 'BG') {
          setBgResults(found);
          setBgFullText(pagesText);
          setBgPdfUrl(downloadUrl);
        } else {
          setAditamentoResults(found);
          setAditamentoFullText(pagesText);
          setAditamentoPdfUrl(downloadUrl);
        }

        // If admin, save to Firestore
        if (user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') {
          try {
            const docId = currentDocType === 'BG' ? 'latest_bg' : 'latest_aditamento';
            await setDoc(doc(db, 'bg_analysis', docId), {
              fileName: name,
              results: found,
              fullText: pagesText,
              pdfUrl: downloadUrl,
              uploadedAt: new Date().toISOString(),
              uploadedBy: user?.displayName || loggedInOfficer?.name || 'Administrador',
              docType: currentDocType,
              bgNumber: uploadBgNumber,
              bgDate: uploadBgDate
            });
            toast.success('Análise salva com sucesso no banco de dados!');
          } catch (error) {
            console.error('Erro ao salvar análise:', error);
            toast.error('O arquivo foi processado, mas não pôde ser salvo no banco de dados. Verifique suas permissões.');
          }
        }
      }
      
      if (found.length === 0 && !append) {
        toast.info('Nenhuma correspondência encontrada no PDF.');
      } else if (found.length > 0) {
        toast.success(`Processamento de ${name} concluído! ${found.length} identificações encontradas.`);
      }
      
      // Clear upload fields
      setUploadBgNumber('');
      setUploadBgDate('');
    } catch (error: any) {
      console.error('PDF Processing Error:', error);
      const errorMessage = error?.message || 'Erro desconhecido';
      toast.error(`Erro ao processar PDF: ${errorMessage}. Verifique se o arquivo é válido e se você tem permissão.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    if (!dateStr.includes('-')) return dateStr; // Already formatted or different format
    try {
      const [year, month, day] = dateStr.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) { // 50MB limit
        toast.error('O arquivo é muito grande. O limite é de 50MB.');
        return;
      }
      file.arrayBuffer().then(data => processPDF(data, file.name)).catch(err => {
        console.error('Erro ao ler arquivo:', err);
        toast.error('Erro ao ler o arquivo selecionado.');
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <Loader2 className="w-8 h-8 animate-spin text-[#5A5A40]" />
      </div>
    );
  }

  if (!user && !loggedInOfficer) {
    return <LoginScreen onLogin={handleOfficerLogin} onAdminLogin={handleLogin} isLoggingIn={isLoggingIn} />;
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] font-sans text-[#1a1a1a] flex flex-col lg:flex-row">
      <Toaster position="top-right" />
      
      {/* Mobile Header */}
      <header className="lg:hidden bg-white border-b border-black/5 p-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#5A5A40]/5 rounded-xl flex items-center justify-center">
            <img 
              src="https://lh3.googleusercontent.com/d/1ZeVU9ZIkPN3wqDDLTMbTM3zuH1KnUMbl" 
              alt="Logo" 
              className="w-8 h-8 object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          <span className="font-serif font-bold text-lg">5º BPM</span>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 hover:bg-[#f5f5f0] rounded-xl transition-colors"
        >
          {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>
      
      {showChangePassword && (
        <ChangePasswordModal 
          onSave={handlePasswordChange} 
          onCancel={() => setShowChangePassword(false)}
        />
      )}

      {showProfileUpdate && (
        <ProfileUpdateModal 
          initialEmail={loggedInOfficer?.email}
          initialPhone={loggedInOfficer?.phone}
          onSave={handleProfileUpdate}
          onCancel={() => setShowProfileUpdate(false)}
        />
      )}
      
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-black/5 p-8 flex flex-col transform transition-transform duration-300 lg:translate-x-0 lg:static lg:inset-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col items-center mb-12">
          <div className="w-24 h-24 mb-4 relative">
            <div className="absolute inset-0 bg-[#5A5A40]/5 rounded-3xl -rotate-6 transition-transform group-hover:rotate-0"></div>
            <img 
              src="https://lh3.googleusercontent.com/d/1ZeVU9ZIkPN3wqDDLTMbTM3zuH1KnUMbl" 
              alt="5º BPM Logo" 
              className="w-full h-full object-contain relative z-10 rounded-2xl"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-serif font-bold tracking-tight text-[#1a1a1a]">5º BPM</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/40">Câmara Cascudo</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-8 p-4 bg-[#f5f5f0] rounded-2xl border border-black/5">
          <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center shrink-0">
            <FileText className="text-white w-6 h-6" />
          </div>
          <div className="min-w-0">
            <span className="text-lg font-serif font-light block truncate">SIA-PMRN</span>
            <div className="space-y-1 mt-1">
              {bgNumber ? (
                <div className="flex items-center gap-1 text-[9px] font-bold text-green-600 uppercase tracking-wider">
                  <ShieldCheck className="w-2.5 h-2.5" />
                  BG: {bgNumber} - {formatDate(bgDate)}
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[9px] font-bold text-[#5A5A40]/40 uppercase tracking-wider">
                  <FileText className="w-2.5 h-2.5" />
                  BG: Pendente
                </div>
              )}
              {aditamentoNumber ? (
                <div className="flex items-center gap-1 text-[9px] font-bold text-blue-600 uppercase tracking-wider">
                  <ShieldCheck className="w-2.5 h-2.5" />
                  ADIT: {aditamentoNumber} - {formatDate(aditamentoDate)}
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[9px] font-bold text-[#5A5A40]/40 uppercase tracking-wider">
                  <FileText className="w-2.5 h-2.5" />
                  ADIT: Pendente
                </div>
              )}
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => {
              setActiveTab('dashboard');
              setIsSidebarOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-200",
              activeTab === 'dashboard' 
                ? "bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20" 
                : "text-[#5A5A40]/60 hover:bg-[#f5f5f0] hover:text-[#5A5A40]"
            )}
          >
            <Search className="w-5 h-5" />
            <span className="font-medium">Painel de Verificação</span>
          </button>

          {loggedInOfficer && (
            <button
              onClick={() => {
                setActiveTab('keywords');
                setIsSidebarOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-200",
                activeTab === 'keywords' 
                  ? "bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20" 
                  : "text-[#5A5A40]/60 hover:bg-[#f5f5f0] hover:text-[#5A5A40]"
              )}
            >
              <Tag className="w-5 h-5" />
              <span className="font-medium">Minhas Palavras-Chave</span>
            </button>
          )}

          {(user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') && (
            <>
              <button
                onClick={() => {
                  setActiveTab('database');
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-200",
                  activeTab === 'database' 
                    ? "bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20" 
                    : "text-[#5A5A40]/60 hover:bg-[#f5f5f0] hover:text-[#5A5A40]"
                )}
              >
                <Users className="w-5 h-5" />
                <span className="font-medium">Banco de Dados</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('settings');
                  setIsSidebarOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-200",
                  activeTab === 'settings' 
                    ? "bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20" 
                    : "text-[#5A5A40]/60 hover:bg-[#f5f5f0] hover:text-[#5A5A40]"
                )}
              >
                <Settings className="w-5 h-5" />
                <span className="font-medium">Configurações</span>
              </button>
            </>
          )}
        </nav>

        <div className="pt-8 border-t border-black/5">
          {user || loggedInOfficer ? (
            <>
              {loggedInOfficer && (
                <button 
                  onClick={() => setShowProfileUpdate(true)}
                  className="w-full flex items-center gap-3 mb-2 px-6 py-3 text-[#5A5A40] hover:bg-[#f5f5f0] rounded-xl transition-colors font-medium text-sm"
                >
                  <UserIcon className="w-4 h-4" />
                  Meus Dados
                </button>
              )}
              <button 
                onClick={() => {
                  setActiveTab('settings');
                  if (loggedInOfficer) setShowChangePassword(true);
                }}
                className="w-full flex items-center gap-3 mb-6 px-2 hover:bg-[#f5f5f0] p-2 rounded-2xl transition-colors text-left"
              >
                {user && user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-10 h-10 rounded-full border border-black/5" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#5A5A40] flex items-center justify-center text-white font-bold shrink-0">
                    {user ? user.displayName?.charAt(0) : loggedInOfficer?.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-[#1a1a1a]">{user ? user.displayName : loggedInOfficer?.name}</p>
                  <p className="text-xs text-[#5A5A40]/60 truncate">
                    {(user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') ? 'Administrador' : 'Trocar Senha'}
                  </p>
                </div>
              </button>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-6 py-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sair
              </button>
            </>
          ) : (
            <button 
              onClick={handleLogin}
              className="w-full flex items-center gap-3 px-6 py-3 bg-[#5A5A40] text-white rounded-xl hover:bg-[#4a4a35] transition-colors font-bold text-sm justify-center"
            >
              <LogIn className="w-4 h-4" />
              Acesso Administrativo
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 lg:p-12 max-w-7xl mx-auto w-full overflow-x-hidden">
        <div className="flex flex-col md:flex-row justify-between mb-8 items-start md:items-center gap-4 md:gap-6">
          <div className="flex flex-wrap gap-3">
            {bgPdfUrl && (
              <button 
                onClick={() => window.open(bgPdfUrl, '_blank')}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#5A5A40]/10 rounded-full text-[#5A5A40] hover:bg-[#f5f5f0] transition-all shadow-sm group text-xs"
              >
                <FileText className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                <span className="font-bold uppercase tracking-widest">BG DO DIA</span>
              </button>
            )}
            {aditamentoPdfUrl && (
              <button 
                onClick={() => window.open(aditamentoPdfUrl, '_blank')}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#5A5A40]/10 rounded-full text-[#5A5A40] hover:bg-[#f5f5f0] transition-all shadow-sm group text-xs"
              >
                <FileText className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                <span className="font-bold uppercase tracking-widest">ADITAMENTO</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-full border border-black/5 shadow-sm">
            <div className="w-7 h-7 rounded-full bg-[#5A5A40]/10 flex items-center justify-center">
              <UserIcon className="w-3.5 h-3.5 text-[#5A5A40]" />
            </div>
            <span className="text-xs font-medium text-[#5A5A40]/60">
              Olá, <span className="text-[#5A5A40] font-bold">{user ? user.displayName : loggedInOfficer?.name}</span>
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              {!detailView ? (
                <>
                  <header className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                  <h2 className="text-3xl md:text-5xl font-serif font-light mb-4">Painel de Verificação</h2>
                  <p className="text-[#5A5A40] italic font-serif max-w-2xl text-sm md:text-base">
                    Acompanhe aqui as identificações automáticas realizadas nos últimos documentos oficiais da PMRN.
                  </p>
                </div>
              </header>

              {/* User Highlight Summary - Combined */}
              {loggedInOfficer && (bgFileName || aditamentoFileName) && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "rounded-[32px] md:rounded-[40px] p-6 md:p-10 border-2 transition-all duration-500",
                    userSpecificResults.length > 0 
                      ? "bg-red-50 border-red-200 shadow-xl shadow-red-900/5" 
                      : "bg-green-50 border-green-200 shadow-xl shadow-green-900/5"
                  )}
                >
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-8">
                    <div className="flex items-center gap-4 md:gap-6">
                      <div className={cn(
                        "w-14 h-14 md:w-20 md:h-20 rounded-2xl md:rounded-3xl flex items-center justify-center animate-pulse shrink-0",
                        userSpecificResults.length > 0 ? "bg-red-500 text-white" : "bg-green-500 text-white"
                      )}>
                        {userSpecificResults.length > 0 ? <AlertCircle className="w-6 h-6 md:w-10 md:h-10" /> : <CheckCircle2 className="w-6 h-6 md:w-10 md:h-10" />}
                      </div>
                      <div>
                        <h3 className="text-2xl md:text-4xl font-serif font-bold mb-1 md:mb-2">
                          {userSpecificResults.length > 0 ? 'Atenção: Menções Encontradas!' : 'Nada Consta nos Documentos'}
                        </h3>
                        <p className={cn(
                          "text-sm md:text-lg font-serif italic",
                          userSpecificResults.length > 0 ? "text-red-700" : "text-green-700"
                        )}>
                          {userSpecificResults.length > 0 
                            ? 'Confira abaixo as ocorrências identificadas tanto no Boletim Geral quanto no Aditamento.' 
                            : 'Seu nome, matrícula e palavras-chave não foram encontrados nos documentos atuais.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {userSpecificResults.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {userSpecificResults.map((res, i) => (
                        <div key={i} className="bg-white/60 backdrop-blur-sm rounded-2xl p-6 border border-red-100">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-bold uppercase tracking-widest text-red-600">{res.label}</span>
                            <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-lg">Pág. {res.page}</span>
                          </div>
                          <p className="font-bold text-red-900 mb-2">{res.match}</p>
                          <p className="text-sm text-red-800/70 italic line-clamp-2">{res.context}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* BG Results Section */}
              {bgFileName && (
                <div className="space-y-8 pt-8 border-t border-black/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 md:w-12 md:h-12 bg-green-50 text-green-600 rounded-xl md:rounded-2xl flex items-center justify-center">
                        <FileText className="w-5 h-5 md:w-6 md:h-6" />
                      </div>
                      <h3 className="text-2xl md:text-3xl font-serif font-light">Boletim Geral (BG)</h3>
                    </div>
                    <div className="flex items-center gap-2 bg-white/50 px-4 py-2 rounded-xl md:rounded-2xl border border-[#5A5A40]/10 w-fit">
                      <ShieldCheck className="w-4 h-4 text-green-600" />
                      <span className="text-xs md:text-sm font-serif text-[#5A5A40]">
                        Nº {bgNumber}, de {formatDate(bgDate)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <button 
                      onClick={() => setDetailView({ docType: 'BG', category: 'officer' })}
                      className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all text-left group"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <Users className="w-6 h-6" />
                        </div>
                        <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">Policiais</span>
                      </div>
                      <p className="text-4xl font-serif">{bgResults.filter(r => r.type === 'officer').length}</p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-[#5A5A40]/60">No Boletim Geral</p>
                        <ChevronRight className="w-4 h-4 text-[#5A5A40]/20 group-hover:text-[#5A5A40] transition-colors" />
                      </div>
                    </button>
                    <button 
                      onClick={() => setDetailView({ docType: 'BG', category: 'unit' })}
                      className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all text-left group"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors">
                          <Building2 className="w-6 h-6" />
                        </div>
                        <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">5º BPM</span>
                      </div>
                      <p className="text-4xl font-serif">
                        {bgResults.filter(r => 
                          r.type === 'unit' && 
                          (normalizeText(r.match).includes('5 bpm') || 
                           normalizeText(r.match).includes('5bpm') || 
                           normalizeText(r.match).includes('5 batalhao') ||
                           normalizeText(r.match).includes('5batalhao'))
                        ).length}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-[#5A5A40]/60">No Boletim Geral</p>
                        <ChevronRight className="w-4 h-4 text-[#5A5A40]/20 group-hover:text-[#5A5A40] transition-colors" />
                      </div>
                    </button>
                    <button 
                      onClick={() => setDetailView({ docType: 'BG', category: 'term' })}
                      className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all text-left group"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors">
                          <Search className="w-6 h-6" />
                        </div>
                        <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">Termos</span>
                      </div>
                      <p className="text-4xl font-serif">
                        {bgResults.filter(r => r.type === 'term').length}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-[#5A5A40]/60">No Boletim Geral</p>
                        <ChevronRight className="w-4 h-4 text-[#5A5A40]/20 group-hover:text-[#5A5A40] transition-colors" />
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Aditamento Results Section */}
              {aditamentoFileName && (
                <div className="space-y-8 pt-8 border-t border-black/5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-50 text-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center">
                        <FileText className="w-5 h-5 md:w-6 md:h-6" />
                      </div>
                      <h3 className="text-2xl md:text-3xl font-serif font-light">Aditamento</h3>
                    </div>
                    <div className="flex items-center gap-2 bg-white/50 px-4 py-2 rounded-xl md:rounded-2xl border border-[#5A5A40]/10 w-fit">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      <span className="text-xs md:text-sm font-serif text-[#5A5A40]">
                        Nº {aditamentoNumber}, de {formatDate(aditamentoDate)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <button 
                      onClick={() => setDetailView({ docType: 'ADITAMENTO', category: 'officer' })}
                      className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all text-left group"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                          <Users className="w-6 h-6" />
                        </div>
                        <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">Policiais</span>
                      </div>
                      <p className="text-4xl font-serif">{aditamentoResults.filter(r => r.type === 'officer').length}</p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-[#5A5A40]/60">No Aditamento</p>
                        <ChevronRight className="w-4 h-4 text-[#5A5A40]/20 group-hover:text-[#5A5A40] transition-colors" />
                      </div>
                    </button>
                    <button 
                      onClick={() => setDetailView({ docType: 'ADITAMENTO', category: 'unit' })}
                      className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all text-left group"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors">
                          <Building2 className="w-6 h-6" />
                        </div>
                        <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">5º BPM</span>
                      </div>
                      <p className="text-4xl font-serif">
                        {aditamentoResults.filter(r => 
                          r.type === 'unit' && 
                          (normalizeText(r.match).includes('5 bpm') || 
                           normalizeText(r.match).includes('5bpm') || 
                           normalizeText(r.match).includes('5 batalhao') ||
                           normalizeText(r.match).includes('5batalhao'))
                        ).length}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-[#5A5A40]/60">No Aditamento</p>
                        <ChevronRight className="w-4 h-4 text-[#5A5A40]/20 group-hover:text-[#5A5A40] transition-colors" />
                      </div>
                    </button>
                    <button 
                      onClick={() => setDetailView({ docType: 'ADITAMENTO', category: 'term' })}
                      className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all text-left group"
                    >
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors">
                          <Search className="w-6 h-6" />
                        </div>
                        <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">Termos</span>
                      </div>
                      <p className="text-4xl font-serif">
                        {aditamentoResults.filter(r => r.type === 'term').length}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm text-[#5A5A40]/60">No Aditamento</p>
                        <ChevronRight className="w-4 h-4 text-[#5A5A40]/20 group-hover:text-[#5A5A40] transition-colors" />
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {!bgFileName && !aditamentoFileName && (
                  <div className="bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-20 border border-black/5 text-center shadow-sm">
                    <div className="w-16 h-16 md:w-24 md:h-24 bg-[#f5f5f0] rounded-full flex items-center justify-center mx-auto mb-6 md:mb-8">
                      <FileSearch className="w-8 h-8 md:w-10 md:h-10 text-[#5A5A40]/20" />
                    </div>
                    <h3 className="text-2xl md:text-3xl font-serif font-bold mb-4">Nenhum documento analisado</h3>
                    <p className="text-base md:text-lg text-[#5A5A40]/60 font-serif italic max-w-md mx-auto">
                      Carregue um Boletim Geral ou Aditamento na área abaixo para iniciar a identificação automática.
                    </p>
                  </div>
              )}

              {/* Upload Area (Admin Only) */}
              {(user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') && (
                <div className="space-y-6">
                  <div className="flex gap-4 mb-2">
                    <button 
                      onClick={() => setUploadDocType('BG')}
                      className={cn(
                        "flex-1 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all",
                        uploadDocType === 'BG' ? "bg-[#5A5A40] text-white shadow-md" : "bg-white text-[#5A5A40]/40 border border-black/5"
                      )}
                    >
                      Boletim Geral (BG)
                    </button>
                    <button 
                      onClick={() => setUploadDocType('ADITAMENTO')}
                      className={cn(
                        "flex-1 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all",
                        uploadDocType === 'ADITAMENTO' ? "bg-[#5A5A40] text-white shadow-md" : "bg-white text-[#5A5A40]/40 border border-black/5"
                      )}
                    >
                      Aditamento
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">Número do {uploadDocType}</label>
                      <input 
                        type="text"
                        placeholder="Ex: 065"
                        value={uploadBgNumber}
                        onChange={(e) => setUploadBgNumber(e.target.value)}
                        className="w-full bg-white border border-black/5 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">Data do {uploadDocType}</label>
                      <input 
                        type="date"
                        value={uploadBgDate}
                        onChange={(e) => setUploadBgDate(e.target.value)}
                        className="w-full bg-white border border-black/5 rounded-2xl px-6 py-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
                      />
                    </div>
                  </div>

                  <div className="relative group">
                    <input 
                      type="file" 
                      accept=".pdf" 
                      onChange={onFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      disabled={isProcessing || !uploadBgNumber || !uploadBgDate}
                    />
                    <div className={cn(
                      "border-2 border-dashed rounded-[40px] p-16 flex flex-col items-center justify-center transition-all duration-300",
                      isProcessing ? "bg-white/50 border-[#5A5A40]/20" : 
                      (!uploadBgNumber || !uploadBgDate) ? "bg-black/5 border-black/5 cursor-not-allowed" :
                      "bg-white border-[#5A5A40]/10 group-hover:border-[#5A5A40]/40 group-hover:bg-white/80"
                    )}>
                      {isProcessing ? (
                        <div className="text-center space-y-6">
                          <div className="relative w-24 h-24 mx-auto">
                            <Loader2 className="w-24 h-24 animate-spin text-[#5A5A40]" />
                            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">
                              {progress}%
                            </div>
                          </div>
                          <p className="text-xl font-serif italic text-[#5A5A40]">{processingMessage}</p>
                        </div>
                      ) : (
                        <>
                          <div className={cn(
                            "w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-transform",
                            (!uploadBgNumber || !uploadBgDate) ? "bg-black/5" : "bg-[#f5f5f0] group-hover:scale-110"
                          )}>
                            <Upload className={cn(
                              "w-8 h-8",
                              (!uploadBgNumber || !uploadBgDate) ? "text-black/20" : "text-[#5A5A40]"
                            )} />
                          </div>
                          <p className={cn(
                            "text-2xl font-serif mb-2",
                            (!uploadBgNumber || !uploadBgDate) ? "text-black/20" : "text-black"
                          )}>
                            {(!uploadBgNumber || !uploadBgDate) ? "Preencha o Número e Data acima" : "Arraste o PDF ou clique para selecionar"}
                          </p>
                          <p className="text-[#5A5A40]/60">{uploadDocType === 'BG' ? 'Boletim Geral' : 'Aditamento'} da PMRN (PDF)</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
                </>
              ) : (
                <div className="space-y-8">
                  <header className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                      <button 
                        onClick={() => setDetailView(null)}
                        className="w-12 h-12 bg-white rounded-2xl border border-black/5 flex items-center justify-center hover:bg-[#5A5A40] hover:text-white transition-all shadow-sm"
                      >
                        <ArrowLeft className="w-6 h-6" />
                      </button>
                      <div>
                        <h2 className="text-3xl md:text-4xl font-serif font-light">
                          Detalhamento: {detailView.docType}
                        </h2>
                        <p className="text-[#5A5A40] italic font-serif">
                          Filtrado por: <span className="font-bold uppercase tracking-widest text-xs ml-1">
                            {detailView.category === 'officer' ? 'Policiais' : detailView.category === 'unit' ? '5º BPM' : 'Termos'}
                          </span>
                        </p>
                      </div>
                    </div>
                    {((detailView.docType === 'BG' && bgPdfUrl) || (detailView.docType === 'ADITAMENTO' && aditamentoPdfUrl)) && (
                      <button 
                        onClick={() => window.open(detailView.docType === 'BG' ? bgPdfUrl! : aditamentoPdfUrl!, '_blank')}
                        className="hidden md:flex items-center gap-2 px-6 py-3 bg-white rounded-2xl border border-black/5 text-xs font-bold uppercase tracking-widest text-[#5A5A40] hover:bg-[#f5f5f0] transition-all"
                      >
                        <ExternalLink className="w-4 h-4" /> Ver PDF Original
                      </button>
                    )}
                  </header>

                  <div className="bg-white rounded-[40px] border border-black/5 overflow-hidden shadow-sm">
                    <div className="divide-y divide-black/5 min-h-[400px]">
                      {(detailView.docType === 'BG' ? bgResults : aditamentoResults)
                        .filter(res => {
                          if (detailView.category === 'officer') return res.type === 'officer';
                          if (detailView.category === 'unit') {
                            return res.type === 'unit' && 
                              (normalizeText(res.match).includes('5 bpm') || 
                               normalizeText(res.match).includes('5bpm') || 
                               normalizeText(res.match).includes('5 batalhao') ||
                               normalizeText(res.match).includes('5batalhao'));
                          }
                          if (detailView.category === 'term') return res.type === 'term';
                          return true;
                        })
                        .length > 0 ? (
                        (detailView.docType === 'BG' ? bgResults : aditamentoResults)
                          .filter(res => {
                            if (detailView.category === 'officer') return res.type === 'officer';
                            if (detailView.category === 'unit') {
                              return res.type === 'unit' && 
                                (normalizeText(res.match).includes('5 bpm') || 
                                 normalizeText(res.match).includes('5bpm') || 
                                 normalizeText(res.match).includes('5 batalhao') ||
                                 normalizeText(res.match).includes('5batalhao'));
                            }
                            if (detailView.category === 'term') return res.type === 'term';
                            return true;
                          })
                          .map((res, i) => (
                            <div key={i} className="p-8 hover:bg-[#fcfcfc] transition-colors group">
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-4">
                                  <div className={cn(
                                    "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                                    res.type === 'officer' ? "bg-blue-50 text-blue-600" : 
                                    res.type === 'unit' ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-600"
                                  )}>
                                    {res.type === 'officer' ? 'Policial' : res.type === 'unit' ? 'Unidade' : 'Termo'}
                                  </div>
                                  <span className="text-xs font-bold text-[#5A5A40]/40 uppercase tracking-widest">Página {res.page}</span>
                                </div>
                              </div>
                              <p className="text-xl font-serif font-bold mb-2 text-[#1a1a1a]">{res.match}</p>
                              <p className="text-[#5A5A40]/70 italic font-serif leading-relaxed">"{res.context}"</p>
                            </div>
                          ))
                      ) : (
                        <div className="p-20 text-center">
                          <FileSearch className="w-16 h-16 text-[#5A5A40]/10 mx-auto mb-6" />
                          <p className="text-xl text-[#5A5A40]/40 font-serif italic">Nenhuma identificação encontrada para este filtro.</p>
                          <button 
                            onClick={() => setDetailView(null)}
                            className="mt-8 px-8 py-4 bg-[#f5f5f0] text-[#5A5A40] font-bold rounded-2xl hover:bg-[#5A5A40] hover:text-white transition-all"
                          >
                            Voltar ao Painel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'keywords' && loggedInOfficer && (
            <motion.div 
              key="keywords"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              <header>
                <h2 className="text-3xl md:text-5xl font-serif font-light mb-4">Minhas Palavras-Chave</h2>
                <p className="text-[#5A5A40] italic font-serif text-sm md:text-base">Gerencie os termos que o sistema deve identificar para você.</p>
              </header>

              <div className="bg-white rounded-[32px] md:rounded-[40px] p-6 md:p-12 border border-black/5">
                <div className="max-w-2xl">
                  <h3 className="text-xl md:text-2xl font-serif mb-6">Suas Palavras-Chave</h3>
                  <p className="text-[#5A5A40]/60 mb-8 text-sm md:text-base">
                    Adicione termos como seu nome, matrícula ou unidades de interesse. 
                    O sistema destacará estes termos sempre que encontrá-los em um Boletim Geral.
                  </p>

                  <div className="flex flex-col md:flex-row gap-4 mb-8">
                    <input 
                      type="text"
                      placeholder="Adicionar novo termo..."
                      className="flex-1 bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20 text-sm md:text-base"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = e.currentTarget.value.trim();
                          if (val) {
                            const current = loggedInOfficer.keywords || [];
                            if (!current.includes(val)) {
                              updateKeywords([...current, val]);
                              e.currentTarget.value = '';
                            } else {
                              toast.error('Este termo já existe.');
                            }
                          }
                        }
                      }}
                    />
                    <button 
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        const val = input.value.trim();
                        if (val) {
                          const current = loggedInOfficer.keywords || [];
                          if (!current.includes(val)) {
                            updateKeywords([...current, val]);
                            input.value = '';
                          } else {
                            toast.error('Este termo já existe.');
                          }
                        }
                      }}
                      className="bg-[#5A5A40] text-white px-8 py-4 md:py-0 rounded-2xl font-bold hover:bg-[#4a4a35] transition-all text-sm md:text-base"
                    >
                      Adicionar
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {(loggedInOfficer.keywords || []).length > 0 ? (
                      loggedInOfficer.keywords?.map((kw, idx) => (
                        <div 
                          key={idx}
                          className="flex items-center gap-2 bg-[#f5f5f0] text-[#5A5A40] px-4 py-2 rounded-full border border-[#5A5A40]/10 group"
                        >
                          <span className="font-medium">{kw}</span>
                          <button 
                            onClick={() => {
                              const current = loggedInOfficer.keywords || [];
                              updateKeywords(current.filter(k => k !== kw));
                            }}
                            className="p-1 hover:text-red-500 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="w-full py-12 text-center border-2 border-dashed border-black/5 rounded-[30px]">
                        <Tag className="w-12 h-12 text-[#5A5A40]/10 mx-auto mb-4" />
                        <p className="text-[#5A5A40]/40 italic">Nenhuma palavra-chave cadastrada.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'database' && (
            <motion.div 
              key="database"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <h2 className="text-3xl md:text-5xl font-serif font-light mb-4">Banco de Dados</h2>
                  <p className="text-[#5A5A40] italic font-serif text-sm md:text-base">Gerencie os registros para identificação automática.</p>
                </div>
                <div className="flex flex-wrap bg-white p-2 rounded-2xl md:rounded-full border border-black/5">
                  {[
                    { id: 'officers', label: 'Policiais' },
                    { id: 'units', label: 'Unidades' },
                    { id: 'terms', label: 'Termos' },
                    { id: 'admins', label: 'Admins' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setDbTab(tab.id as any)}
                      className={cn(
                        "px-4 md:px-8 py-2 md:py-3 rounded-xl md:rounded-full text-xs md:text-sm font-bold transition-all flex-1 md:flex-none",
                        dbTab === tab.id ? "bg-[#5A5A40] text-white" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </header>

              {/* Forms */}
              <div className="bg-white rounded-[32px] md:rounded-[40px] p-6 md:p-10 border border-black/5 shadow-sm space-y-8">
                {dbTab === 'officers' && (
                  <div className="space-y-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-black/5">
                      <h3 className="text-xl font-serif">Adicionar Policial</h3>
                      <div className="relative w-full md:w-auto">
                        <input 
                          type="file" 
                          accept=".xlsx, .xls, .csv" 
                          onChange={handleBulkUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          disabled={isBulkUploading}
                        />
                        <button 
                          disabled={isBulkUploading}
                          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#f5f5f0] text-[#5A5A40] rounded-full hover:bg-[#e5e5e0] transition-colors font-bold text-sm"
                        >
                          {isBulkUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                          Importar Planilha
                        </button>
                      </div>
                    </div>
                    <form onSubmit={addOfficer} className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Nome Completo</label>
                        <input 
                          required
                          value={newOfficer.name}
                          onChange={e => setNewOfficer({...newOfficer, name: e.target.value})}
                          className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                          placeholder="Ex: João Silva"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Matrícula</label>
                        <input 
                          required
                          value={newOfficer.registration}
                          onChange={e => setNewOfficer({...newOfficer, registration: e.target.value})}
                          className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                          placeholder="Ex: 123.456-7"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Unidade</label>
                        <input 
                          required
                          value={newOfficer.unit}
                          onChange={e => setNewOfficer({...newOfficer, unit: e.target.value})}
                          className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                          placeholder="Ex: 1º BPM"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Nível de Acesso</label>
                        <select 
                          value={newOfficer.role}
                          onChange={e => setNewOfficer({...newOfficer, role: e.target.value as 'admin' | 'user'})}
                          className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20 appearance-none"
                        >
                          <option value="user">Usuário Comum</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </div>
                      <button type="submit" className="bg-[#5A5A40] text-white rounded-2xl py-4 flex items-center justify-center gap-2 hover:bg-[#4a4a35] transition-colors">
                        <Plus className="w-5 h-5" />
                        Adicionar
                      </button>
                    </form>
                  </div>
                )}

                {dbTab === 'units' && (
                  <form onSubmit={addUnit} className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Nome da Unidade</label>
                      <input 
                        required
                        value={newUnit.name}
                        onChange={e => setNewUnit({...newUnit, name: e.target.value})}
                        className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                        placeholder="Ex: Batalhão de Choque"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Sigla</label>
                      <input 
                        value={newUnit.acronym}
                        onChange={e => setNewUnit({...newUnit, acronym: e.target.value})}
                        className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                        placeholder="Ex: BPChoque"
                      />
                    </div>
                    <button type="submit" className="bg-[#5A5A40] text-white rounded-2xl py-4 flex items-center justify-center gap-2 hover:bg-[#4a4a35] transition-colors">
                      <Plus className="w-5 h-5" />
                      Adicionar
                    </button>
                  </form>
                )}

                {dbTab === 'terms' && (
                  <form onSubmit={addTerm} className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Termo de Pesquisa</label>
                      <input 
                        required
                        value={newTerm.term}
                        onChange={e => setNewTerm({...newTerm, term: e.target.value})}
                        className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                        placeholder="Ex: Promoção"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Categoria</label>
                      <input 
                        value={newTerm.category}
                        onChange={e => setNewTerm({...newTerm, category: e.target.value})}
                        className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                        placeholder="Ex: Evento"
                      />
                    </div>
                    <button type="submit" className="bg-[#5A5A40] text-white rounded-2xl py-4 flex items-center justify-center gap-2 hover:bg-[#4a4a35] transition-colors">
                      <Plus className="w-5 h-5" />
                      Adicionar
                    </button>
                  </form>
                )}

                {dbTab === 'admins' && (
                  <div className="space-y-8">
                    <div className="pb-6 border-b border-black/5">
                      <h3 className="text-xl font-serif mb-2">Autorizar Administrador (Gmail)</h3>
                      <p className="text-sm text-[#5A5A40]/60 italic">Estes usuários poderão acessar o sistema via Google Login, independente da lista de policiais.</p>
                    </div>
                    <form onSubmit={addAdmin} className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                      <div className="md:col-span-2 space-y-2">
                        <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">E-mail do Gmail</label>
                        <input 
                          required
                          type="email"
                          value={newAdminEmail}
                          onChange={e => setNewAdminEmail(e.target.value)}
                          className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
                          placeholder="exemplo@gmail.com"
                        />
                      </div>
                      <button type="submit" className="bg-[#5A5A40] text-white rounded-2xl py-4 flex items-center justify-center gap-2 hover:bg-[#4a4a35] transition-colors">
                        <ShieldCheck className="w-5 h-5" />
                        Autorizar Acesso
                      </button>
                    </form>

                    <div className="mt-8">
                      <h4 className="text-sm font-bold uppercase tracking-widest text-[#5A5A40]/40 mb-4">Administradores Autorizados</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-[#f5f5f0] p-4 rounded-2xl flex items-center justify-between border border-[#5A5A40]/10">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-[#5A5A40] text-white rounded-full flex items-center justify-center">
                              <ShieldCheck className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="font-bold text-sm">{ADMIN_EMAIL}</p>
                              <p className="text-[10px] text-[#5A5A40]/60 uppercase font-bold tracking-widest">Administrador Mestre</p>
                            </div>
                          </div>
                        </div>
                        {authorizedAdmins.map(admin => (
                          <div key={admin.id} className="bg-white p-4 rounded-2xl flex items-center justify-between border border-black/5 shadow-sm group">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-[#f5f5f0] text-[#5A5A40] rounded-full flex items-center justify-center">
                                <UserIcon className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="font-bold text-sm">{admin.email}</p>
                                <p className="text-[10px] text-[#5A5A40]/60 uppercase font-bold tracking-widest">Acesso via Gmail</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => removeAdmin(admin.id, admin.email)}
                              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Tables */}
              {dbTab !== 'admins' && (
                <div className="bg-white rounded-[40px] overflow-hidden border border-black/5 shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#f5f5f0]/50 border-bottom border-black/5">
                        {dbTab === 'officers' && (
                          <>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Nome</th>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Matrícula</th>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Unidade</th>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Acesso</th>
                          </>
                        )}
                        {dbTab === 'units' && (
                          <>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Nome</th>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Sigla</th>
                          </>
                        )}
                        {dbTab === 'terms' && (
                          <>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Termo</th>
                            <th className="px-8 py-6 text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60">Categoria</th>
                          </>
                        )}
                        <th className="px-8 py-6"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dbTab === 'officers' && officers.map(off => (
                        <tr key={off.id} className="border-t border-black/5 hover:bg-[#f5f5f0]/20 transition-colors">
                          <td className="px-8 py-6 font-medium">{off.name}</td>
                          <td className="px-8 py-6 font-mono text-sm">{off.registration}</td>
                          <td className="px-8 py-6">{off.unit}</td>
                          <td className="px-8 py-6">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest",
                              off.role === 'admin' ? "bg-[#5A5A40] text-white" : "bg-[#f5f5f0] text-[#5A5A40]/60"
                            )}>
                              {off.role === 'admin' ? 'Admin' : 'Usuário'}
                            </span>
                          </td>
                          <td className="px-8 py-6 text-right">
                            <button onClick={() => deleteItem('officers', off.id)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {dbTab === 'units' && units.map(unit => (
                        <tr key={unit.id} className="border-t border-black/5 hover:bg-[#f5f5f0]/20 transition-colors">
                          <td className="px-8 py-6 font-medium">{unit.name}</td>
                          <td className="px-8 py-6">{unit.acronym || '-'}</td>
                          <td className="px-8 py-6 text-right">
                            <button onClick={() => deleteItem('units', unit.id)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {dbTab === 'terms' && searchTerms.map(st => (
                        <tr key={st.id} className="border-t border-black/5 hover:bg-[#f5f5f0]/20 transition-colors">
                          <td className="px-8 py-6 font-medium">{st.term}</td>
                          <td className="px-8 py-6">{st.category || '-'}</td>
                          <td className="px-8 py-6 text-right">
                            <button onClick={() => deleteItem('searchTerms', st.id)} className="p-2 text-red-400 hover:text-red-600 transition-colors">
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              <header>
                <h2 className="text-5xl font-serif font-light mb-4">Configurações</h2>
                <p className="text-[#5A5A40] italic font-serif">Ajustes do sistema e preferências.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white rounded-[40px] p-10 border border-black/5">
                  <h3 className="text-2xl font-serif mb-8">Preferências de Análise</h3>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold">Sensibilidade de Busca</p>
                        <p className="text-sm text-[#5A5A40]/60">Ignorar maiúsculas/minúsculas</p>
                      </div>
                      <div className="w-12 h-6 bg-[#5A5A40] rounded-full relative">
                        <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold">Contexto de Identificação</p>
                        <p className="text-sm text-[#5A5A40]/60">Mostrar 100 caracteres ao redor do match</p>
                      </div>
                      <div className="w-12 h-6 bg-[#5A5A40] rounded-full relative">
                        <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[40px] p-10 border border-black/5">
                  <h3 className="text-2xl font-serif mb-8">Segurança</h3>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between py-4 border-b border-black/5">
                      <div>
                        <p className="font-bold">Alterar Senha</p>
                        <p className="text-sm text-[#5A5A40]/60">Atualize sua senha de acesso ao sistema</p>
                      </div>
                      <button 
                        onClick={() => setShowChangePassword(true)}
                        className="px-6 py-3 bg-[#f5f5f0] text-[#5A5A40] font-bold rounded-xl hover:bg-[#5A5A40] hover:text-white transition-all"
                      >
                        Alterar
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[40px] p-10 border border-black/5">
                  <h3 className="text-2xl font-serif mb-8">Sobre o Sistema</h3>
                  <div className="space-y-4 text-[#5A5A40]">
                    <p><strong>Versão:</strong> 1.0.0-alpha</p>
                    <p><strong>Desenvolvido para:</strong> PMRN</p>
                    <p className="text-sm italic pt-4 border-t border-black/5">
                      Este sistema utiliza tecnologia de OCR e processamento de linguagem natural para auxiliar na triagem de documentos oficiais.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- Components ---

function LoginScreen({ onLogin, onAdminLogin, isLoggingIn }: { onLogin: (reg: string, pass: string) => void, onAdminLogin: () => void, isLoggingIn: boolean }) {
  const [registration, setRegistration] = useState('');
  const [password, setPassword] = useState('');
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);

  const currentDomain = window.location.hostname;

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-12 shadow-xl shadow-black/5 border border-black/5"
      >
        <div className="flex flex-col items-center mb-10">
          <div className="w-20 h-20 md:w-24 md:h-24 mb-6 relative">
            <div className="absolute inset-0 bg-[#5A5A40]/5 rounded-3xl -rotate-6"></div>
            <img 
              src="https://lh3.googleusercontent.com/d/1ZeVU9ZIkPN3wqDDLTMbTM3zuH1KnUMbl" 
              alt="5º BPM Logo" 
              className="w-full h-full object-contain relative z-10 rounded-2xl"
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-light tracking-tight mb-2">SIA-PMRN</h1>
          <p className="text-[#5A5A40]/60 italic font-serif text-center text-sm md:text-base">Sistema de Identificação Automatizada</p>
        </div>

        <form 
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(registration, password);
          }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">Matrícula</label>
            <input 
              required
              value={registration}
              onChange={e => setRegistration(e.target.value)}
              className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
              placeholder="Digite sua matrícula"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">Senha</label>
            <input 
              required
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20 transition-all"
              placeholder="Sua senha"
            />
            <p className="text-[10px] text-[#5A5A40]/40 ml-2 italic">Primeiro acesso? Use sua matrícula como senha.</p>
          </div>

          <button 
            type="submit"
            className="w-full bg-[#5A5A40] text-white rounded-2xl py-5 font-bold shadow-lg shadow-[#5A5A40]/20 hover:bg-[#4a4a35] transition-all active:scale-[0.98]"
          >
            Entrar no Sistema
          </button>
        </form>

        <div className="mt-10 pt-8 border-t border-black/5 space-y-4">
          <button 
            onClick={onAdminLogin}
            disabled={isLoggingIn}
            className="w-full flex items-center justify-center gap-2 text-sm font-bold text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors disabled:opacity-50"
          >
            {isLoggingIn ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {isLoggingIn ? 'Autenticando...' : 'Acesso Administrativo (Google)'}
          </button>

          <div className="text-center">
            <button 
              onClick={() => setShowTroubleshooting(!showTroubleshooting)}
              className="text-[10px] text-[#5A5A40]/40 hover:underline"
            >
              Problemas com o login Google?
            </button>
          </div>

          {showTroubleshooting && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="bg-red-50 border border-red-100 rounded-2xl p-4 text-[11px] text-red-800 space-y-2"
            >
              <p className="font-bold">Se a tela do Google "pisca e some":</p>
              <p>Você precisa autorizar este domínio no Console do Firebase:</p>
              <div className="bg-white/50 p-2 rounded font-mono break-all select-all">
                {currentDomain}
              </div>
              <p>Passos:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Acesse o <a href="https://console.firebase.google.com/" target="_blank" className="underline font-bold">Console Firebase</a></li>
                <li>Vá em <b>Authentication</b> {'>'} <b>Settings</b> {'>'} <b>Authorized domains</b></li>
                <li>Clique em <b>Add domain</b> e cole o endereço acima</li>
              </ol>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function ChangePasswordModal({ onSave, onCancel }: { onSave: (pass: string) => void, onCancel: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.');
      return;
    }
    if (newPassword.length < 4) {
      toast.error('A senha deve ter pelo menos 4 caracteres.');
      return;
    }
    onSave(newPassword);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-12 shadow-2xl border border-black/5"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 md:w-16 md:h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
            <Key className="text-blue-600 w-6 h-6 md:w-8 md:h-8" />
          </div>
          <h2 className="text-2xl md:text-3xl font-serif font-light mb-2">Alterar Senha</h2>
          <p className="text-[#5A5A40]/60 text-center text-sm md:text-base">Defina uma nova senha segura para sua conta.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">Nova Senha</label>
            <input 
              required
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
              placeholder="Mínimo 4 caracteres"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">Confirmar Senha</label>
            <input 
              required
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
              placeholder="Repita a nova senha"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-[#5A5A40] text-white rounded-2xl py-5 font-bold shadow-lg shadow-[#5A5A40]/20 hover:bg-[#4a4a35] transition-all"
          >
            Salvar Nova Senha
          </button>
          
          <button 
            type="button"
            onClick={onCancel}
            className="w-full text-sm font-bold text-[#5A5A40]/40 hover:text-red-500 transition-colors"
          >
            Cancelar
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function ProfileUpdateModal({ initialEmail, initialPhone, onSave, onCancel }: { initialEmail?: string, initialPhone?: string, onSave: (email: string, phone: string) => void, onCancel: () => void }) {
  const [email, setEmail] = useState(initialEmail || '');
  const [phone, setPhone] = useState(initialPhone || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !phone) {
      toast.error('Por favor, preencha todos os campos.');
      return;
    }
    onSave(email, phone);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white rounded-[32px] md:rounded-[40px] p-8 md:p-12 shadow-2xl border border-black/5"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 md:w-16 md:h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
            <UserIcon className="text-blue-600 w-6 h-6 md:w-8 md:h-8" />
          </div>
          <h2 className="text-2xl md:text-3xl font-serif font-light mb-2">Dados Cadastrais</h2>
          <p className="text-[#5A5A40]/60 text-center text-sm md:text-base">Mantenha seus dados atualizados para receber informações importantes.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">E-mail</label>
            <input 
              required
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
              placeholder="seu@email.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/60 ml-2">Telefone / WhatsApp</label>
            <input 
              required
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
              placeholder="(00) 00000-0000"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-[#5A5A40] text-white rounded-2xl py-5 font-bold shadow-lg shadow-[#5A5A40]/20 hover:bg-[#4a4a35] transition-all"
          >
            Salvar Dados
          </button>
          
          <button 
            type="button"
            onClick={onCancel}
            className="w-full text-sm font-bold text-[#5A5A40]/40 hover:text-red-500 transition-colors"
          >
            Cancelar
          </button>
        </form>
      </motion.div>
    </div>
  );
}
