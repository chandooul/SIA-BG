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
  User as UserIcon,
  Key,
  ShieldCheck
} from 'lucide-react';
import { 
  auth, 
  db, 
  storage,
  ref,
  uploadBytes,
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
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  getDocs, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  onSnapshot,
  where,
  setDoc
} from 'firebase/firestore';
import * as pdfjsLib from 'pdfjs-dist';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// PDF.js worker setup - using a reliable CDN that matches the installed version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs`;

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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'database' | 'settings' | 'keywords'>('dashboard');
  const [dbTab, setDbTab] = useState<'officers' | 'units' | 'terms'>('officers');
  
  // Database State
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([]);
  
  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<IdentificationResult[]>([]);
  const [fullText, setFullText] = useState<{page: number, text: string}[]>([]);
  const [userSpecificResults, setUserSpecificResults] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Form States
  const [newOfficer, setNewOfficer] = useState({ name: '', registration: '', unit: '', rank: '', role: 'user' as 'admin' | 'user' });
  const [newUnit, setNewUnit] = useState({ name: '', acronym: '' });
  const [newTerm, setNewTerm] = useState({ term: '', category: '' });
  const [isBulkUploading, setIsBulkUploading] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      
      // If user is not admin and is on an admin tab, redirect to dashboard
      const isAdmin = u?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin';
      if (!isAdmin && (activeTab === 'database' || activeTab === 'settings')) {
        setActiveTab('dashboard');
      }
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

    const unsubBG = onSnapshot(doc(db, 'bg_analysis', 'latest'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setResults(data.results || []);
        setFullText(data.fullText || []);
        setFileName(data.fileName || null);
        setPdfUrl(data.pdfUrl || null);
        setUploadedAt(data.uploadedAt || null);
        console.log('Latest BG analysis loaded from Firestore');
      }
    }, (err) => {
      console.error('Error fetching latest BG:', err);
      toast.error('Erro ao buscar o último BG. Verifique as permissões.');
      handleFirestoreError(err, OperationType.GET, 'bg_analysis/latest');
    });

    return () => {
      unsubOfficers();
      unsubUnits();
      unsubTerms();
      unsubBG();
    };
  }, []);

  const ADMIN_EMAIL = "chandooul@gmail.com";

  const handleLogin = async () => {
    console.log('Attempting Google login...');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const loggedUser = result.user;
      console.log('Login successful for:', loggedUser.email);
      
      if (loggedUser.email !== ADMIN_EMAIL) {
        console.warn('User is not an authorized administrator:', loggedUser.email);
        toast.error('Acesso negado. Esta conta não possui privilégios administrativos.');
        // Optionally sign out if not admin, or just keep them logged in but restricted
      } else {
        toast.success('Acesso administrativo concedido!');
      }
    } catch (error: any) {
      console.error('Login error details:', error);
      if (error.code === 'auth/popup-blocked') {
        toast.error('O popup de login foi bloqueado pelo navegador. Por favor, permita popups para este site.');
      } else if (error.code === 'auth/cancelled-popup-request') {
        // User closed the popup, no need for a loud error
      } else {
        toast.error(`Erro ao realizar login: ${error.message}`);
      }
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

  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Helper for flexible matching
  const normalizeText = (text: string) => {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/\s+/g, ' ')           // Simplify whitespace
      .trim();
  };

  const normalizeTextFuzzy = (text: string) => {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
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
    const normalized = unit.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const numMatch = normalized.match(/(\d+)/);
    if (!numMatch) return [unit.toLowerCase()];
    
    const n = numMatch[1];
    const variations = new Set([
      unit.toLowerCase(),
      `${n}bpm`,
      `${n}°bpm`,
      `${n}° bpm`,
      `${n} bpm`,
      `${n}° batalhao`,
      `${n}° batalhão`,
      `${n} batalhao`,
      `${n} batalhão`
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
    
    // 1. Check global results for matches with current user (Cross-referencing)
    results.forEach(res => {
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
    if (fullText.length) {
      const keywords = loggedInOfficer.keywords || [];
      const identifiers = [
        loggedInOfficer.registration,
        loggedInOfficer.name
      ].filter(Boolean);

      fullText.forEach(pageData => {
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
  }, [results, fullText, loggedInOfficer?.keywords, loggedInOfficer?.registration, loggedInOfficer?.name, loggedInOfficer?.unit]);

  const processPDF = async (data: ArrayBuffer, name: string, append = false) => {
    console.log('Starting PDF processing for:', name);
    
    setIsProcessing(true);
    setFileName(prev => append && prev ? `${prev} + ${name}` : name);
    if (!append) {
      setResults([]);
      setFullText([]);
    }
    setProgress(0);

    try {
      const blob = new Blob([data], { type: 'application/pdf' });
      setPdfBlob(blob);
      
      // Delete previous file if it exists and we're not appending
      if (pdfUrl && !append) {
        try {
          const oldFileRef = ref(storage, pdfUrl);
          await deleteObject(oldFileRef);
          console.log('Previous PDF deleted from Storage');
        } catch (deleteError) {
          console.warn('Could not delete previous PDF (it might have been already deleted):', deleteError);
        }
      }

      // Upload to Firebase Storage
      const storageRef = ref(storage, `bg_files/${name}`);
      const uploadResult = await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(uploadResult.ref);
      setPdfUrl(downloadUrl);

      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const numPages = pdf.numPages;
      const found: IdentificationResult[] = [];
      const pagesText: {page: number, text: string}[] = [];

      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const text = textContent.items.map((item: any) => item.str).join(' ');
          const textNormalized = normalizeText(text);
          const textFuzzy = normalizeTextFuzzy(text);
          
          pagesText.push({ page: i, text });
          setProgress(Math.round((i / numPages) * 100));

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
        const newResults = [...results, ...found];
        const newFullText = [...fullText, ...pagesText];
        setResults(newResults);
        setFullText(newFullText);
        // If admin, save to Firestore
        if (user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') {
          await setDoc(doc(db, 'bg_analysis', 'latest'), {
            fileName: fileName ? `${fileName} + ${name}` : name,
            results: newResults,
            fullText: newFullText,
            pdfUrl: downloadUrl,
            uploadedAt: new Date().toISOString(),
            uploadedBy: user?.displayName || loggedInOfficer?.name || 'Administrador'
          });
        }
      } else {
        setResults(found);
        setFullText(pagesText);
        // If admin, save to Firestore
        if (user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') {
          await setDoc(doc(db, 'bg_analysis', 'latest'), {
            fileName: name,
            results: found,
            fullText: pagesText,
            pdfUrl: downloadUrl,
            uploadedAt: new Date().toISOString(),
            uploadedBy: user?.displayName || loggedInOfficer?.name || 'Administrador'
          });
        }
      }
      
      if (found.length === 0 && !append) {
        toast.info('Nenhuma correspondência encontrada no PDF.');
      } else if (found.length > 0) {
        toast.success(`Processamento de ${name} concluído! ${found.length} identificações encontradas.`);
      }
    } catch (error) {
      console.error('PDF Processing Error:', error);
      toast.error('Erro ao processar PDF. Verifique se o arquivo é válido.');
    } finally {
      setIsProcessing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      file.arrayBuffer().then(data => processPDF(data, file.name));
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
    return <LoginScreen onLogin={handleOfficerLogin} onAdminLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] font-sans text-[#1a1a1a]">
      <Toaster position="top-right" />
      
      {showChangePassword && (
        <ChangePasswordModal 
          onSave={handlePasswordChange} 
          onCancel={() => setShowChangePassword(false)}
        />
      )}
      
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white border-r border-black/5 p-8 flex flex-col">
        <div className="flex flex-col items-center mb-12">
          <div className="w-24 h-24 mb-4 relative">
            <div className="absolute inset-0 bg-[#5A5A40]/5 rounded-3xl -rotate-6 transition-transform group-hover:rotate-0"></div>
            <img 
              src="https://firebasestorage.googleapis.com/v0/b/my-project-1571939616356.firebasestorage.app/o/bg_files%2Flogo_5bpm.png?alt=media" 
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
            <span className="text-lg font-serif font-light block truncate">SIA-BG</span>
            {uploadedAt && new Date(uploadedAt).toDateString() === new Date().toDateString() ? (
              <div className="flex items-center gap-1 text-[10px] font-bold text-green-600 uppercase tracking-wider">
                <ShieldCheck className="w-3 h-3" />
                BG Atualizado
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[10px] font-bold text-orange-600 uppercase tracking-wider">
                <AlertCircle className="w-3 h-3" />
                BG Pendente
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-200",
              activeTab === 'dashboard' 
                ? "bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20" 
                : "text-[#5A5A40]/60 hover:bg-[#f5f5f0] hover:text-[#5A5A40]"
            )}
          >
            <Search className="w-5 h-5" />
            <span className="font-medium">Verificação BG</span>
          </button>

          {loggedInOfficer && (
            <button
              onClick={() => setActiveTab('keywords')}
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
                onClick={() => setActiveTab('database')}
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
                onClick={() => setActiveTab('settings')}
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
      <main className="ml-72 p-12 max-w-7xl mx-auto">
        <div className="flex justify-end mb-8 items-center gap-6">
          {fileName && (
            <button 
              onClick={() => {
                if (pdfBlob) {
                  const url = URL.createObjectURL(pdfBlob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } else if (pdfUrl) {
                  window.open(pdfUrl, '_blank');
                } else {
                  toast.info('O arquivo original não está disponível no momento.');
                }
              }}
              className="flex items-center gap-2 px-6 py-2 bg-white border border-[#5A5A40]/10 rounded-full text-[#5A5A40] hover:bg-[#f5f5f0] transition-all shadow-sm group"
            >
              <FileText className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span className="font-bold text-xs uppercase tracking-widest">BG DO DIA</span>
            </button>
          )}
          <div className="flex items-center gap-3 bg-white px-6 py-2 rounded-full border border-black/5 shadow-sm">
            <div className="w-8 h-8 rounded-full bg-[#5A5A40]/10 flex items-center justify-center">
              <UserIcon className="w-4 h-4 text-[#5A5A40]" />
            </div>
            <span className="text-sm font-medium text-[#5A5A40]/60">
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
              <header className="flex items-end justify-between">
                <div>
                  <h2 className="text-5xl font-serif font-light mb-4">Verificação BG</h2>
                  <p className="text-[#5A5A40] italic font-serif">
                    {(user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') 
                      ? "Carregue o Boletim Geral do dia para análise e compartilhamento." 
                      : "Resultados da análise do último Boletim Geral carregado."}
                  </p>
                </div>
              </header>

              {/* Global Analysis Summary */}
              {fileName && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                        <Users className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">Policiais</span>
                    </div>
                    <p className="text-4xl font-serif">{results.filter(r => r.type === 'officer').length}</p>
                    <p className="text-sm text-[#5A5A40]/60 mt-2">Identificados no banco de dados</p>
                  </div>
                  <div className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center">
                        <Building2 className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">5º BPM</span>
                    </div>
                    <p className="text-4xl font-serif">
                      {results.filter(r => 
                        r.type === 'unit' && 
                        (normalizeText(r.match).includes('5 bpm') || normalizeText(r.match).includes('5 batalhao'))
                      ).length}
                    </p>
                    <p className="text-sm text-[#5A5A40]/60 mt-2">Menções ao 5º Batalhão</p>
                  </div>
                  <div className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center">
                        <Search className="w-6 h-6" />
                      </div>
                      <span className="text-sm font-bold text-[#5A5A40]/40 uppercase tracking-widest">Termos</span>
                    </div>
                    <p className="text-4xl font-serif">
                      {userSpecificResults.filter(r => r.type === 'personal').length}
                    </p>
                    <p className="text-sm text-[#5A5A40]/60 mt-2">Suas palavras-chave mencionadas</p>
                  </div>
                </div>
              )}

              {/* User Highlight Summary */}
              {loggedInOfficer && fileName && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "rounded-[40px] p-10 border-2 transition-all duration-500",
                    userSpecificResults.length > 0 
                      ? "bg-red-50 border-red-200 shadow-xl shadow-red-900/5" 
                      : "bg-green-50 border-green-200 shadow-xl shadow-green-900/5"
                  )}
                >
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-6">
                      <div className={cn(
                        "w-20 h-20 rounded-3xl flex items-center justify-center animate-pulse",
                        userSpecificResults.length > 0 ? "bg-red-500 text-white" : "bg-green-500 text-white"
                      )}>
                        {userSpecificResults.length > 0 ? <AlertCircle className="w-10 h-10" /> : <CheckCircle2 className="w-10 h-10" />}
                      </div>
                      <div>
                        <h3 className="text-4xl font-serif font-bold mb-2">
                          {userSpecificResults.length > 0 ? 'Atenção: Menções Encontradas!' : 'Nada Consta no Boletim'}
                        </h3>
                        <p className={cn(
                          "text-lg font-serif italic",
                          userSpecificResults.length > 0 ? "text-red-700" : "text-green-700"
                        )}>
                          {userSpecificResults.length > 0 
                            ? 'Confira abaixo os detalhes das ocorrências identificadas.' 
                            : 'Seu nome, matrícula e palavras-chave não foram encontrados neste boletim.'}
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

              {/* Upload Area (Admin Only) */}
              {(user?.email === ADMIN_EMAIL || loggedInOfficer?.role === 'admin') && (
                <div className="relative group">
                  <input 
                    type="file" 
                    accept=".pdf" 
                    onChange={onFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    disabled={isProcessing}
                  />
                  <div className={cn(
                    "border-2 border-dashed rounded-[40px] p-16 flex flex-col items-center justify-center transition-all duration-300",
                    isProcessing ? "bg-white/50 border-[#5A5A40]/20" : "bg-white border-[#5A5A40]/10 group-hover:border-[#5A5A40]/40 group-hover:bg-white/80"
                  )}>
                    {isProcessing ? (
                      <div className="text-center space-y-6">
                        <div className="relative w-24 h-24 mx-auto">
                          <Loader2 className="w-24 h-24 animate-spin text-[#5A5A40]" />
                          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">
                            {progress}%
                          </div>
                        </div>
                        <p className="text-xl font-serif italic text-[#5A5A40]">Analisando documento...</p>
                      </div>
                    ) : (
                      <>
                        <div className="w-20 h-20 bg-[#f5f5f0] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                          <Upload className="text-[#5A5A40] w-8 h-8" />
                        </div>
                        <p className="text-2xl font-serif mb-2">Arraste o PDF ou clique para selecionar</p>
                        <p className="text-[#5A5A40]/60">Boletim Geral da PMRN (PDF)</p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Results */}
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-black/5">
                      <FileText className="text-[#5A5A40] w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-serif font-light">
                        {results.length > 0 ? `Resultados Encontrados (${results.length})` : 'Resultados da Identificação'}
                      </h3>
                      <p className="text-[#5A5A40]/60 text-sm">
                        {fileName ? `Arquivo: ${fileName}` : 'Nenhum boletim analisado recentemente.'}
                      </p>
                    </div>
                  </div>
                  {results.length > 0 && (
                    <div className="flex gap-4">
                      <button className="flex items-center gap-2 px-6 py-3 bg-white rounded-full border border-black/5 hover:bg-[#f5f5f0] transition-colors">
                        <Filter className="w-4 h-4" />
                        Filtrar
                      </button>
                      <button className="flex items-center gap-2 px-6 py-3 bg-[#5A5A40] text-white rounded-full hover:bg-[#4a4a35] transition-colors">
                        <Download className="w-4 h-4" />
                        Exportar Relatório
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {results.map((res, idx) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      key={idx}
                      className="bg-white rounded-3xl p-8 border border-black/5 hover:shadow-xl hover:shadow-black/5 transition-all"
                    >
                      <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center",
                            res.type === 'officer' ? "bg-blue-50 text-blue-600" : 
                            res.type === 'unit' ? "bg-green-50 text-green-600" : "bg-orange-50 text-orange-600"
                          )}>
                            {res.type === 'officer' ? <Users className="w-6 h-6" /> : 
                             res.type === 'unit' ? <Building2 className="w-6 h-6" /> : <Search className="w-6 h-6" />}
                          </div>
                          <div>
                            <span className="text-xs font-bold uppercase tracking-widest text-[#5A5A40]/40 mb-1 block">
                              {res.type === 'officer' ? 'Policial Identificado' : 
                               res.type === 'unit' ? 'Unidade Identificada' : 'Termo Personalizado'}
                            </span>
                            <h4 className="text-xl font-bold">{res.match}</h4>
                          </div>
                        </div>
                        <div className="px-4 py-2 bg-[#f5f5f0] rounded-full text-sm font-bold text-[#5A5A40]">
                          Página {res.page}
                        </div>
                      </div>
                      <div className="bg-[#f5f5f0]/50 rounded-2xl p-6 border border-black/5">
                        <p className="text-[#5A5A40] italic font-serif leading-relaxed">
                          {res.context}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
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
                <h2 className="text-5xl font-serif font-light mb-4">Minhas Palavras-Chave</h2>
                <p className="text-[#5A5A40] italic font-serif">Gerencie os termos que o sistema deve identificar para você.</p>
              </header>

              <div className="bg-white rounded-[40px] p-12 border border-black/5">
                <div className="max-w-2xl">
                  <h3 className="text-2xl font-serif mb-6">Suas Palavras-Chave</h3>
                  <p className="text-[#5A5A40]/60 mb-8">
                    Adicione termos como seu nome, matrícula ou unidades de interesse. 
                    O sistema destacará estes termos sempre que encontrá-los em um Boletim Geral.
                  </p>

                  <div className="flex gap-4 mb-8">
                    <input 
                      type="text"
                      placeholder="Adicionar novo termo..."
                      className="flex-1 bg-[#f5f5f0] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-[#5A5A40]/20"
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
                      className="bg-[#5A5A40] text-white px-8 rounded-2xl font-bold hover:bg-[#4a4a35] transition-all"
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
              <header className="flex items-end justify-between">
                <div>
                  <h2 className="text-5xl font-serif font-light mb-4">Banco de Dados</h2>
                  <p className="text-[#5A5A40] italic font-serif">Gerencie os registros para identificação automática.</p>
                </div>
                <div className="flex bg-white p-2 rounded-full border border-black/5">
                  {[
                    { id: 'officers', label: 'Policiais' },
                    { id: 'units', label: 'Unidades' },
                    { id: 'terms', label: 'Termos' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setDbTab(tab.id as any)}
                      className={cn(
                        "px-8 py-3 rounded-full text-sm font-bold transition-all",
                        dbTab === tab.id ? "bg-[#5A5A40] text-white" : "text-[#5A5A40]/60 hover:text-[#5A5A40]"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </header>

              {/* Forms */}
              <div className="bg-white rounded-[40px] p-10 border border-black/5 shadow-sm space-y-8">
                {dbTab === 'officers' && (
                  <div className="space-y-8">
                    <div className="flex items-center justify-between pb-6 border-b border-black/5">
                      <h3 className="text-xl font-serif">Adicionar Policial</h3>
                      <div className="relative">
                        <input 
                          type="file" 
                          accept=".xlsx, .xls, .csv" 
                          onChange={handleBulkUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          disabled={isBulkUploading}
                        />
                        <button 
                          disabled={isBulkUploading}
                          className="flex items-center gap-2 px-6 py-3 bg-[#f5f5f0] text-[#5A5A40] rounded-full hover:bg-[#e5e5e0] transition-colors font-bold text-sm"
                        >
                          {isBulkUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                          Importar Planilha (Excel/CSV)
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
              </div>

              {/* Tables */}
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

function LoginScreen({ onLogin, onAdminLogin }: { onLogin: (reg: string, pass: string) => void, onAdminLogin: () => void }) {
  const [registration, setRegistration] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[40px] p-12 shadow-xl shadow-black/5 border border-black/5"
      >
        <div className="flex flex-col items-center mb-10">
          <div className="w-24 h-24 mb-6 relative">
            <div className="absolute inset-0 bg-[#5A5A40]/5 rounded-3xl -rotate-6"></div>
            <img 
              src="https://firebasestorage.googleapis.com/v0/b/my-project-1571939616356.firebasestorage.app/o/bg_files%2Flogo_5bpm.png?alt=media" 
              alt="5º BPM Logo" 
              className="w-full h-full object-contain relative z-10 rounded-2xl"
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-4xl font-serif font-light tracking-tight mb-2">SIA-BG</h1>
          <p className="text-[#5A5A40]/60 italic font-serif text-center">Sistema de Identificação Automatizada</p>
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

        <div className="mt-10 pt-8 border-t border-black/5">
          <button 
            onClick={onAdminLogin}
            className="w-full flex items-center justify-center gap-2 text-sm font-bold text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Acesso Administrativo (Google)
          </button>
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
        className="w-full max-w-md bg-white rounded-[40px] p-12 shadow-2xl border border-black/5"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
            <Key className="text-blue-600 w-8 h-8" />
          </div>
          <h2 className="text-3xl font-serif font-light mb-2">Alterar Senha</h2>
          <p className="text-[#5A5A40]/60 text-center">Defina uma nova senha segura para sua conta.</p>
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
