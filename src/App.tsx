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
  FileSpreadsheet
} from 'lucide-react';
import { 
  auth, 
  db, 
  googleProvider, 
  OperationType, 
  handleFirestoreError 
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
  onSnapshot 
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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'database' | 'settings'>('dashboard');
  const [dbTab, setDbTab] = useState<'officers' | 'units' | 'terms'>('officers');
  
  // Database State
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [searchTerms, setSearchTerms] = useState<SearchTerm[]>([]);
  
  // Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<IdentificationResult[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Form States
  const [newOfficer, setNewOfficer] = useState({ name: '', registration: '', unit: '', rank: '' });
  const [newUnit, setNewUnit] = useState({ name: '', acronym: '' });
  const [newTerm, setNewTerm] = useState({ term: '', category: '' });
  const [isBulkUploading, setIsBulkUploading] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Firestore Listeners
  useEffect(() => {
    // Listeners now work for everyone (public read)
    const unsubOfficers = onSnapshot(collection(db, 'officers'), (snapshot) => {
      setOfficers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Officer)));
    }, (err) => {
      // Only log if it's a real error, not just permission (though read is public now)
      console.error('Error fetching officers:', err);
    });

    const unsubUnits = onSnapshot(collection(db, 'units'), (snapshot) => {
      setUnits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Unit)));
    }, (err) => console.error('Error fetching units:', err));

    const unsubTerms = onSnapshot(collection(db, 'searchTerms'), (snapshot) => {
      setSearchTerms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SearchTerm)));
    }, (err) => console.error('Error fetching terms:', err));

    return () => {
      unsubOfficers();
      unsubUnits();
      unsubTerms();
    };
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      toast.success('Login realizado com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao realizar login.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success('Sessão encerrada.');
    } catch (error) {
      console.error(error);
    }
  };

  // Database Actions
  const addOfficer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'officers'), newOfficer);
      setNewOfficer({ name: '', registration: '', unit: '', rank: '' });
      toast.success('Policial adicionado!');
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
    const toastId = toast.loading('Processando planilha...');

    try {
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
            await addDoc(collection(db, 'officers'), officerData);
            successCount++;
          } catch (err) {
            errorCount++;
          }
        } else {
          errorCount++;
        }
      }

      toast.success(`${successCount} policiais importados com sucesso!`, { id: toastId });
      if (errorCount > 0) {
        toast.error(`${errorCount} registros ignorados por falta de dados obrigatórios.`);
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao ler planilha. Verifique o formato.', { id: toastId });
    } finally {
      setIsBulkUploading(false);
      e.target.value = ''; // Reset input
    }
  };

  // PDF Processing
  const processPDF = async (file: File) => {
    setIsProcessing(true);
    setFileName(file.name);
    setResults([]);
    setProgress(0);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      const found: IdentificationResult[] = [];

      for (let i = 1; i <= numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const text = textContent.items.map((item: any) => item.str).join(' ');
          
          setProgress(Math.round((i / numPages) * 100));

          // Search for Officers
          officers.forEach(off => {
            if (!off.name && !off.registration) return;
            
            const nameMatch = off.name && text.includes(off.name);
            const regMatch = off.registration && text.includes(off.registration);

            if (nameMatch || regMatch) {
              const matchStr = nameMatch ? off.name : off.registration;
              const index = text.indexOf(matchStr);
              const start = Math.max(0, index - 60);
              const end = Math.min(text.length, index + matchStr.length + 80);
              const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
              
              found.push({
                type: 'officer',
                match: `${off.name} (${off.registration})`,
                context: `...${context}...`,
                page: i,
                metadata: off
              });
            }
          });

          // Search for Units
          units.forEach(unit => {
            if (!unit.name) return;
            
            const nameMatch = text.includes(unit.name);
            const acronymMatch = unit.acronym && text.includes(unit.acronym);

            if (nameMatch || acronymMatch) {
              const matchStr = nameMatch ? unit.name : (unit.acronym || '');
              const index = text.indexOf(matchStr);
              const start = Math.max(0, index - 60);
              const end = Math.min(text.length, index + matchStr.length + 80);
              const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
              
              found.push({
                type: 'unit',
                match: unit.name,
                context: `...${context}...`,
                page: i,
                metadata: unit
              });
            }
          });

          // Search for Custom Terms
          searchTerms.forEach(st => {
            if (!st.term) return;
            
            const termLower = st.term.toLowerCase();
            const textLower = text.toLowerCase();
            
            if (textLower.includes(termLower)) {
              const index = textLower.indexOf(termLower);
              const start = Math.max(0, index - 60);
              const end = Math.min(text.length, index + st.term.length + 80);
              const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
              
              found.push({
                type: 'term',
                match: st.term,
                context: `...${context}...`,
                page: i,
                metadata: st
              });
            }
          });
        } catch (pageError) {
          console.error(`Erro ao processar página ${i}:`, pageError);
          continue;
        }
      }

      setResults(found);
      toast.success(`Processamento concluído! ${found.length} identificações encontradas.`);
    } catch (error) {
      console.error(error);
      toast.error('Erro ao processar PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPDF(file);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <Loader2 className="w-8 h-8 animate-spin text-[#5A5A40]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] font-sans text-[#1a1a1a]">
      <Toaster position="top-right" />
      
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white border-r border-black/5 p-8 flex flex-col">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center">
            <FileText className="text-white w-6 h-6" />
          </div>
          <span className="text-2xl font-serif font-light tracking-tight">SIA-BG</span>
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
            <span className="font-medium">Identificação</span>
          </button>

          {user && (
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
          {user ? (
            <>
              <div className="flex items-center gap-3 mb-6 px-2">
                <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border border-black/5" referrerPolicy="no-referrer" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{user.displayName}</p>
                  <p className="text-xs text-[#5A5A40]/60 truncate">Administrador</p>
                </div>
              </div>
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
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-12"
            >
              <header>
                <h2 className="text-5xl font-serif font-light mb-4">Identificação</h2>
                <p className="text-[#5A5A40] italic font-serif">Carregue o Boletim Geral para análise automatizada.</p>
              </header>

              {/* Upload Area */}
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

              {/* Results */}
              {results.length > 0 && (
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-3xl font-serif font-light">Resultados Encontrados ({results.length})</h3>
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
              )}
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
                    <form onSubmit={addOfficer} className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
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
