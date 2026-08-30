import React, { useState, useEffect, useRef } from 'react';
import { 
  Home, PlayCircle, User, Settings, Swords, Users, Trophy, 
  ChevronRight, Palette, Loader2, Hash, ArrowLeft, Eye, AlertTriangle, 
  Medal, Flame, History, Award, BarChart2, MessageCircle, X, 
  ChevronRightCircle, UserPlus, UserMinus, Bot 
} from 'lucide-react';

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, doc, getDocs, addDoc, updateDoc, setDoc, getDoc, deleteDoc, onSnapshot, runTransaction, arrayUnion } from "firebase/firestore";

// --- Firebase Initialization ---
const safeGetConfig = () => {
  const defaultCfg = { apiKey: "AIzaSyCWKHVb1tEYOGRP1Jr48fvzeX40juWUz_g", authDomain: "shogi-d2084.firebaseapp.com", databaseURL: "https://shogi-d2084-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "shogi-d2084", storageBucket: "shogi-d2084.firebasestorage.app", messagingSenderId: "454149448024", appId: "1:454149448024:web:223dc3d18113fe14c2c52d" };
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) return JSON.parse(__firebase_config);
    if (typeof window !== 'undefined' && window.__firebase_config) return JSON.parse(window.__firebase_config);
  } catch(e) {}
  return defaultCfg;
};

const appId = (typeof __app_id !== 'undefined' && __app_id) ? __app_id : ((typeof window !== 'undefined' && window.__app_id) ? window.__app_id : 'othello-app-production');
const initialToken = (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) ? __initial_auth_token : ((typeof window !== 'undefined' && window.__initial_auth_token) ? window.__initial_auth_token : null);

let app, auth, db;
try { app = !getApps().length ? initializeApp(safeGetConfig()) : getApp(); auth = getAuth(app); db = getFirestore(app); } catch (e) {}

const getGamesCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'games');
const getGameRef = (gid) => doc(db, 'artifacts', appId, 'public', 'data', 'games', gid);
const getProfileRef = (uid) => doc(db, 'artifacts', appId, 'users', uid, 'profile', 'user_profile');
const getLeaderboardRef = (uid) => doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', uid);

const RESET_VERSION = 4;

// --- Othello Logic ---
const INITIAL_BOARD = Array(8).fill(null).map(() => Array(8).fill(null));
INITIAL_BOARD[3][3] = 'white'; INITIAL_BOARD[3][4] = 'black'; INITIAL_BOARD[4][3] = 'black'; INITIAL_BOARD[4][4] = 'white';
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

const W_MATRIX = [
  [120,-20, 20,  5,  5, 20,-20,120], [-20,-40, -5, -5, -5, -5,-40,-20], [ 20, -5, 15,  3,  3, 15, -5, 20], [  5, -5,  3,  3,  3,  3, -5,  5],
  [  5, -5,  3,  3,  3,  3, -5,  5], [ 20, -5, 15,  3,  3, 15, -5, 20], [-20,-40, -5, -5, -5, -5,-40,-20], [120,-20, 20,  5,  5, 20,-20,120]
];

const clampScore = (score) => Math.max(-500, Math.min(500, score));

const getFlippableStones = (bd, r, c, color) => {
  if (!bd || bd[r][c] !== null) return [];
  const opp = color === 'black' ? 'white' : 'black';
  let flips = [];
  for (let [dr, dc] of DIRS) {
    let tr = r + dr, tc = c + dc, tmp = [];
    while (tr >= 0 && tr < 8 && tc >= 0 && tc < 8 && bd[tr][tc] === opp) { tmp.push([tr, tc]); tr += dr; tc += dc; }
    if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8 && bd[tr][tc] === color && tmp.length > 0) flips.push(...tmp);
  }
  return flips;
};

const getValidMoves = (bd, color) => {
  if (!bd) return [];
  let m = [];
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) if (getFlippableStones(bd, r, c, color).length > 0) m.push(`${r},${c}`);
  return m;
};

const countStones = (bd) => {
  let b = 0, w = 0;
  if (!bd) return { black: 0, white: 0 };
  bd.forEach(row => row.forEach(cell => { if (cell === 'black') b++; if (cell === 'white') w++; }));
  return { black: b, white: w };
};

const getMoveFromBoards = (prevBoard, currentBoard, turn) => {
  if (!prevBoard || !currentBoard) return null;
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) if (prevBoard[r][c] === null && currentBoard[r][c] === turn) return { r, c };
  return null;
};

const calcRatingChange = (myRate, oppRate, myStones, oppStones, isWin, isDraw, currentStreak = 0, isAI = false, oppCurrentStreak = 0) => {
  const K = 72, expected = 1 / (1 + Math.pow(10, (oppRate - myRate) / 400));
  let baseDiff = K * ((isDraw ? 0.5 : (isWin ? 1 : 0)) - expected);
  let bonus = isDraw ? 0 : (myStones - oppStones) * 0.5; 
  if (isWin && currentStreak >= 5) bonus += (isAI ? 1 : 10) + Math.min(40, (currentStreak - 5) * 2) * (isAI ? 0.1 : 1);
  if (isWin && oppCurrentStreak >= 5) bonus += Math.min(80, (oppCurrentStreak - 4) * 10) * (isAI ? 0.1 : 1);
  let change = Math.round(baseDiff + bonus);
  if (isDraw) return Math.max(-5, Math.min(5, change));
  if (!isWin && currentStreak >= 5) change = Math.round(change * 1.2);
  if (isAI) change = Math.round(change / 2);
  if (isWin && change < 1) change = 1;
  if (!isWin && change > -1) change = -1;
  return change;
};

// --- AI (Minimax) Logic ---
const getAiDepth = (rating, isStrongAI = false) => {
  let depth = 4 + Math.floor((rating - 1000) / 300); 
  return isStrongAI ? Math.max(1, Math.min(depth + 2, 8)) : Math.max(1, Math.min(depth, 6));
};

const getSimulatedMoves = (board, color) => {
  let moves = [];
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
    const flips = getFlippableStones(board, r, c, color);
    if (flips.length > 0) moves.push({ r, c, flips });
  }
  return moves;
};

const evaluateBoard = (board, color) => {
  const opp = color === 'black' ? 'white' : 'black';
  let score = 0, myStones = 0, oppStones = 0, emptyStones = 0;
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
    if (board[r][c] === color) { myStones++; score += W_MATRIX[r][c]; }
    else if (board[r][c] === opp) { oppStones++; score -= W_MATRIX[r][c]; }
    else emptyStones++;
  }
  if (emptyStones <= 12) return (myStones - oppStones) * 10;
  score += (getValidMoves(board, color).length - getValidMoves(board, opp).length) * 15;
  if (emptyStones <= 30) score += (myStones - oppStones) * 2;
  if (emptyStones <= 15) score += (myStones - oppStones) * 5;
  return score;
};

const minimax = (board, depth, alpha, beta, isMaximizing, color, origColor, endTime) => {
  if (endTime && Date.now() > endTime) throw new Error('TIMEOUT');
  if (depth === 0) return evaluateBoard(board, origColor);
  const moves = getSimulatedMoves(board, color);
  if (moves.length === 0) {
    const opp = color === 'black' ? 'white' : 'black';
    if (getSimulatedMoves(board, opp).length === 0) {
      const {black, white} = countStones(board);
      const mCount = origColor === 'black' ? black : white, oCount = origColor === 'black' ? white : black;
      return mCount > oCount ? 1000 + (mCount - oCount)*10 : (mCount < oCount ? -1000 - (oCount - mCount)*10 : 0);
    }
    return minimax(board, depth - 1, alpha, beta, !isMaximizing, opp, origColor, endTime);
  }
  moves.sort((a, b) => W_MATRIX[b.r][b.c] - W_MATRIX[a.r][a.c]);
  let bestEval = isMaximizing ? -Infinity : Infinity;
  for (let move of moves) {
    let newBoard = board.map(r => [...r]);
    newBoard[move.r][move.c] = color;
    move.flips.forEach(([fr, fc]) => newBoard[fr][fc] = color);
    let ev = minimax(newBoard, depth - 1, alpha, beta, !isMaximizing, color === 'black' ? 'white' : 'black', origColor, endTime);
    if (isMaximizing) { bestEval = Math.max(bestEval, ev); alpha = Math.max(alpha, ev); } 
    else { bestEval = Math.min(bestEval, ev); beta = Math.min(beta, ev); }
    if (beta <= alpha) break;
  }
  return bestEval;
};

const getBestMove = (board, color, depth) => {
  const moves = getSimulatedMoves(board, color);
  if (moves.length === 0) return null;
  if (moves.length === 1) return `${moves[0].r},${moves[0].c}`;
  let bestScore = -Infinity, bestMove = null;
  moves.sort((a, b) => W_MATRIX[b.r][b.c] - W_MATRIX[a.r][a.c]);
  const endTime = Date.now() + 4000; 
  try {
    for (let move of moves) {
      let newBoard = board.map(r => [...r]);
      newBoard[move.r][move.c] = color;
      move.flips.forEach(([fr, fc]) => newBoard[fr][fc] = color);
      let score = minimax(newBoard, depth - 1, -Infinity, Infinity, false, color === 'black' ? 'white' : 'black', color, endTime);
      if (score > bestScore) { bestScore = score; bestMove = move; }
    }
  } catch(e) { if (!bestMove) bestMove = moves[0]; }
  return bestMove ? `${bestMove.r},${bestMove.c}` : null;
};

const THEMES = {
  green: { primary: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-600', light: 'bg-emerald-50', board: 'bg-emerald-800', grid: 'bg-emerald-900', cell: 'bg-emerald-600' },
  blue: { primary: 'bg-blue-600', text: 'text-blue-600', border: 'border-blue-600', light: 'bg-blue-50', board: 'bg-blue-800', grid: 'bg-blue-900', cell: 'bg-blue-600' },
  dark: { primary: 'bg-gray-800', text: 'text-gray-800', border: 'border-gray-800', light: 'bg-gray-200', board: 'bg-gray-700', grid: 'bg-gray-900', cell: 'bg-gray-600' },
};
const STAMPS = ['よろしく！', '考え中…', 'ナイス！', 'あちゃー', '参りました', 'ありがとう！'];

// ==========================================
// メインコンポーネント
// ==========================================
function OthelloApp() {
  const todayStr = new Date().toLocaleDateString('ja-JP');

  const [user, setUser] = useState(null);
  const [isFirstLogin, setIsFirstLogin] = useState(false); 
  const [initName, setInitName] = useState(''); 
  const [initRating, setInitRating] = useState(1000); 
  const [initError, setInitError] = useState(null); 

  const [profile, setProfile] = useState({ name: '', rating: 1000, highestRating: 1000, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], ratingHistory: [], friends: [], theme: 'green' });
  const [currentTab, setCurrentTab] = useState('home'); 
  const [playMode, setPlayMode] = useState(null); 
  
  const [gameId, setGameId] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [localHistory, setLocalHistory] = useState([]); 
  
  const [researchData, setResearchData] = useState({ topMoves: [], evaluation: 0, isAnalyzing: false, actualMoveEval: null });
  const [isDeepAnalysis, setIsDeepAnalysis] = useState(false);
  const [allowAiAnalysis, setAllowAiAnalysis] = useState(true);

  const [analysisHistory, setAnalysisHistory] = useState([]);
  const [analysisTurnHistory, setAnalysisTurnHistory] = useState([]);
  const [analysisIndex, setAnalysisIndex] = useState(0);
  const [evalHistory, setEvalHistory] = useState([]);

  const [showRoomModal, setShowRoomModal] = useState(false);
  const [roomNumber, setRoomNumber] = useState('');
  const [showLeaveAlert, setShowLeaveAlert] = useState(false);
  const [matchTimeoutId, setMatchTimeoutId] = useState(null);
  
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [currentRank, setCurrentRank] = useState(null);
  const [dailyStats, setDailyStats] = useState({ rankDiff: 0, ratingDiff: 0 });

  const [showStampMenu, setShowStampMenu] = useState(false);
  const [activeStamp, setActiveStamp] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);

  const [selectedFriend, setSelectedFriend] = useState(null);
  const [incomingInvitation, setIncomingInvitation] = useState(null);
  const [lastMatchChange, setLastMatchChange] = useState(null);

  const activeTheme = THEMES[profile.theme] || THEMES.green;
  const isAnalysisMode = playMode === 'research' || playMode === 'history_analysis' || (playMode === 'room' && gameState?.allowAiAnalysis);

  const triggerCommError = (msg = "通信エラーです。") => { setToastMessage(msg); setTimeout(() => setToastMessage(null), 3500); };
  
  const getRankStyle = (rate) => {
    if (rate >= 1800) return 'text-purple-600 bg-purple-100';
    if (rate >= 1500) return 'text-blue-600 bg-blue-100';
    if (rate >= 1300) return 'text-yellow-600 bg-yellow-100';
    if (rate >= 1100) return 'text-gray-600 bg-gray-200';
    if (rate >= 900) return 'text-orange-600 bg-orange-100';
    return 'text-green-600 bg-green-100';
  };

  const getStatusColor = (status) => status === 'playing' ? 'bg-yellow-400' : status === 'online' ? 'bg-emerald-500' : 'bg-red-500'; 
  
  const renderDiff = (type, diff) => {
    if (!diff) return <span className="text-gray-400 font-bold text-[11px] flex items-center justify-center">±0</span>;
    if (type === 'rank') return <span className={`font-black text-[11px] flex items-center justify-center ${diff>0?'text-emerald-500':'text-red-500'}`}>{diff>0?`↑${diff}`:`↓${Math.abs(diff)}`}</span>;
    return <span className={`font-black text-[11px] flex items-center justify-center ${diff>0?'text-emerald-500':'text-red-500'}`}>{diff>0?`+${diff}`:diff}</span>;
  };

  const getEvaluationText = () => {
    if (researchData.isAnalyzing) return '計算中...';
    let score = clampScore(researchData.evaluation);
    if (gameState?.turn === 'white') score = -score;
    if (score === 0) return '互角 (0)';
    return `${score > 0 ? '+' : ''}${score} (${score > 0 ? '黒' : '白'}有利)`;
  };

  const renderEvalGraph = () => {
    const w = 300, h = 60, maxTurn = 60;
    const vEvals = evalHistory.filter(v => v !== undefined && v !== null);
    let absMax = vEvals.length > 0 ? Math.max(...vEvals.map(Math.abs)) : 100;
    if (absMax < 100) absMax = 100; if (absMax > 500) absMax = 500;

    const points = evalHistory.map((val, i) => {
      if (val == null) return null;
      let clamped = Math.max(-absMax, Math.min(absMax, val));
      return `${(i / maxTurn) * w},${h/2 - (clamped / absMax) * (h/2)}`;
    });
    const turnIndex = playMode === 'history_analysis' ? analysisIndex : localHistory.length - 1;

    return (
      <div className="w-full h-[60px] bg-gray-50 border border-gray-200 rounded-lg relative overflow-hidden shrink-0 mt-1">
        <div className="absolute w-full h-[1px] bg-gray-300 top-1/2"></div>
        <div className="absolute top-1 left-1 text-[8px] font-bold text-gray-800">黒 有利 (+{absMax})</div>
        <div className="absolute bottom-1 left-1 text-[8px] font-bold text-gray-400">白 有利 (-{absMax})</div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
          <polyline points={points.filter(p=>p).join(' ')} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
          {evalHistory[turnIndex] != null && <circle cx={(turnIndex / maxTurn) * w} cy={h/2 - (Math.max(-absMax, Math.min(absMax, evalHistory[turnIndex])) / absMax) * (h/2)} r="3" fill="#ef4444" />}
        </svg>
      </div>
    );
  };

  const updateUserStatus = async (status) => {
    if (!user || isFirstLogin) return;
    try { await updateDoc(getLeaderboardRef(user.uid), { status }); } catch (e) {}
  };

  // --- Effects ---
  useEffect(() => {
    if (!user || isFirstLogin) return;
    const hVis = () => updateUserStatus(document.visibilityState === 'hidden' ? 'offline' : (playMode ? 'playing' : 'online'));
    const hUnl = () => updateUserStatus('offline');
    document.addEventListener('visibilitychange', hVis); window.addEventListener('beforeunload', hUnl);
    updateUserStatus(playMode ? 'playing' : 'online');
    return () => { document.removeEventListener('visibilitychange', hVis); window.removeEventListener('beforeunload', hUnl); };
  // eslint-disable-next-line
  }, [user, isFirstLogin, playMode]);

  useEffect(() => {
    const hHide = () => { if (gameId && playMode === 'matching') deleteDoc(getGameRef(gameId)).catch(()=>{}); };
    window.addEventListener('pagehide', hHide); window.addEventListener('beforeunload', hHide);
    return () => { window.removeEventListener('pagehide', hHide); window.removeEventListener('beforeunload', hHide); };
  }, [gameId, playMode]);

  useEffect(() => { setToastMessage(null); }, [gameId, playMode]);

  useEffect(() => {
    if (!user || isFirstLogin || !leaderboardData.length) return;
    const myLbData = leaderboardData.find(d => d.uid === user.uid);
    if (myLbData?.invitation) {
      if (Date.now() - myLbData.invitation.time < 60000) { 
        if (!incomingInvitation || incomingInvitation.time !== myLbData.invitation.time) setIncomingInvitation(myLbData.invitation);
      } else updateDoc(getLeaderboardRef(user.uid), { invitation: null }).catch(()=>{});
    } else setIncomingInvitation(null);
  // eslint-disable-next-line
  }, [leaderboardData, user, isFirstLogin, incomingInvitation]);

  useEffect(() => {
    const initAuth = async () => { try { if (initialToken) await signInWithCustomToken(auth, initialToken); else await signInAnonymously(auth); } catch (e) { triggerCommError(); } };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const aiCheck = await getDoc(getLeaderboardRef('ai_bot_19'));
          if (!aiCheck.exists() || aiCheck.data().resetVersion !== RESET_VERSION) {
            for (let i = 0; i < 20; i++) {
              await setDoc(getLeaderboardRef(`ai_bot_${i}`), { uid: `ai_bot_${i}`, name: `AI-Player-${i+1}`, rating: 1000, dailyDate: todayStr, dailyRating: 1000, dailyRank: 0, isAI: true, status: 'online', resetVersion: RESET_VERSION, highestRating: 1000, wins: 0, losses: 0, draws: 0, currentStreak: 0 }).catch(()=>{});
              await setDoc(getProfileRef(`ai_bot_${i}`), { name: `AI-Player-${i+1}`, rating: 1000, highestRating: 1000, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], ratingHistory: [], theme: 'dark', isAI: true, resetVersion: RESET_VERSION }).catch(()=>{});
            }
            for (let i = 0; i < 4; i++) {
              await setDoc(getLeaderboardRef(`ai_bot_strong_${i}`), { uid: `ai_bot_strong_${i}`, name: `AI-Master-${i+1}`, rating: 1000, dailyDate: todayStr, dailyRating: 1000, dailyRank: 0, isAI: true, isStrongAI: true, status: 'online', resetVersion: RESET_VERSION, highestRating: 1000, wins: 0, losses: 0, draws: 0, currentStreak: 0 }).catch(()=>{});
              await setDoc(getProfileRef(`ai_bot_strong_${i}`), { name: `AI-Master-${i+1}`, rating: 1000, highestRating: 1000, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], ratingHistory: [], theme: 'dark', isAI: true, isStrongAI: true, resetVersion: RESET_VERSION }).catch(()=>{});
            }
          }
        } catch(e) {}

        try {
          const pSnap = await getDoc(getProfileRef(currentUser.uid));
          if (pSnap.exists()) {
            let pData = pSnap.data();
            if (pData.resetVersion !== RESET_VERSION) {
              pData = { ...pData, rating: 1000, highestRating: 1000, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], ratingHistory: [], resetVersion: RESET_VERSION };
              await setDoc(getProfileRef(currentUser.uid), pData);
              await setDoc(getLeaderboardRef(currentUser.uid), { uid: currentUser.uid, name: pData.name, rating: 1000, dailyDate: todayStr, dailyRating: 1000, dailyRank: 0, status: 'online', resetVersion: RESET_VERSION, highestRating: 1000, wins: 0, losses: 0, draws: 0, currentStreak: 0 }, { merge: true });
            }
            setProfile({ ...pData, friends: pData.friends || [], ratingHistory: pData.ratingHistory || [] });
            setIsFirstLogin(false);
          } else setIsFirstLogin(true);
        } catch(e) { setIsFirstLogin(true); }
      }
    });
    return () => unsubscribe();
  // eslint-disable-next-line
  }, []);

  const handleInitialRegistration = async () => {
    if (!user || initName.trim() === '') return;
    setInitError(null);
    const selectedRate = Math.max(0, Math.min(1000, Number(initRating) || 0));
    const newProfile = { name: initName.trim(), rating: selectedRate, highestRating: selectedRate, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], ratingHistory: [], friends: [], theme: 'green', resetVersion: RESET_VERSION };
    try {
      await setDoc(getProfileRef(user.uid), newProfile);
      await setDoc(getLeaderboardRef(user.uid), { uid: user.uid, name: newProfile.name, rating: newProfile.rating, dailyDate: todayStr, dailyRating: newProfile.rating, dailyRank: 0, status: 'online', resetVersion: RESET_VERSION, highestRating: selectedRate, wins: 0, losses: 0, draws: 0, currentStreak: 0 });
      setProfile(newProfile); setIsFirstLogin(false);
    } catch (e) { setInitError("通信エラーです。"); }
  };

  const updateProfile = async (updates) => {
    const newProfile = { ...profile, ...updates }; setProfile(newProfile);
    if (user) {
      await updateDoc(getProfileRef(user.uid), updates).catch(e => triggerCommError());
      if (updates.rating !== undefined || updates.name !== undefined || updates.wins !== undefined) {
        await setDoc(getLeaderboardRef(user.uid), { uid: user.uid, name: newProfile.name, rating: newProfile.rating, highestRating: newProfile.highestRating, wins: newProfile.wins, losses: newProfile.losses, draws: newProfile.draws, currentStreak: newProfile.currentStreak }, { merge: true }).catch(e => {});
      }
    }
  };

  const toggleFriend = async (targetUid) => {
    const newFriends = profile.friends?.includes(targetUid) ? profile.friends.filter(id => id !== targetUid) : [...(profile.friends || []), targetUid];
    await updateProfile({ friends: newFriends });
  };

  const handleDeleteData = async () => {
    try {
      if (user) { await deleteDoc(getProfileRef(user.uid)); await deleteDoc(getLeaderboardRef(user.uid)); }
      setProfile({ name: '', rating: 1000, highestRating: 1000, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], ratingHistory: [], friends: [], theme: 'green' });
      setInitName(''); setInitRating(1000); setCurrentTab('home'); setShowDeleteAlert(false); setIsFirstLogin(true);
    } catch (e) { triggerCommError(); setShowDeleteAlert(false); }
  };

  const handleUserClick = async (targetUser) => {
    if (targetUser.uid === user.uid) return;
    try {
      setSelectedFriend({ ...targetUser, profile: null });
      const snap = await getDoc(getLeaderboardRef(targetUser.uid));
      if (snap.exists()) setSelectedFriend(prev => prev?.uid === targetUser.uid ? { ...targetUser, profile: snap.data() } : prev);
    } catch (e) { triggerCommError(); }
  };

  const handleInvite = async (targetUid, mode) => {
    setLastMatchChange(null);
    let newGameId = null;
    const isAI = targetUid.startsWith('ai_bot_');
    const initB = INITIAL_BOARD.map(r => [...r]);
    const isP1 = Math.random() < 0.5;

    let aiData = null;
    if (isAI) {
      aiData = { name: 'AI', rating: 1000, currentStreak: 0 };
      try { const snap = await getDoc(getLeaderboardRef(targetUid)); if (snap.exists()) aiData = { ...aiData, ...snap.data() }; } catch(e) {}
    }

    if (mode === 'room') {
      const pin = Math.floor(1000 + Math.random() * 9000).toString(); 
      await setDoc(getGameRef(pin), {
        gameType: 'room', status: isAI ? 'playing' : 'waiting', board: JSON.stringify(initB), turn: 'black', boardHistory: [JSON.stringify(initB)], turnHistory: ['black'],
        player1: isP1 ? user.uid : (isAI ? targetUid : null), player1Data: isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : (isAI ? aiData : null), 
        player2: !isP1 ? user.uid : (isAI ? targetUid : null), player2Data: !isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : (isAI ? aiData : null), 
        createdAt: Date.now(), allowAiAnalysis 
      });
      newGameId = pin;
    } else if (mode === 'ranked') {
      const newGameRef = await addDoc(getGamesCollection(), {
        gameType: 'ranked', status: isAI ? 'playing' : 'waiting', board: JSON.stringify(initB), turn: 'black', boardHistory: [JSON.stringify(initB)], turnHistory: ['black'],
        player1: isP1 ? user.uid : (isAI ? targetUid : null), player1Data: isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : (isAI ? aiData : null), 
        player2: !isP1 ? user.uid : (isAI ? targetUid : null), player2Data: !isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : (isAI ? aiData : null), 
        resultProcessedBy: [], createdAt: Date.now()
      });
      newGameId = newGameRef.id;
    }

    if (!isAI) {
      await updateDoc(getLeaderboardRef(targetUid), { invitation: { fromUid: user.uid, fromName: profile.name, gameId: newGameId, mode: mode, time: Date.now() } });
      triggerCommError(`招待を送信しました！相手の応答を待っています...`); 
    } else triggerCommError(`AIとの対局を開始します。`);

    setGameId(newGameId); setPlayMode(mode); setCurrentTab('play'); setSelectedFriend(null);
  };

  const acceptInvitation = async () => {
    if (!incomingInvitation) return;
    const { gameId, mode } = incomingInvitation;
    setIncomingInvitation(null); await updateDoc(getLeaderboardRef(user.uid), { invitation: null }).catch(()=>{});
    setToastMessage(null); setLastMatchChange(null); setShowRoomModal(false); setPlayMode('matching'); setCurrentTab('play');

    const roomRef = getGameRef(gameId);
    try {
      let joined = false;
      await runTransaction(db, async (transaction) => {
        const roomDoc = await transaction.get(roomRef);
        if (roomDoc.exists() && roomDoc.data().status === 'waiting') {
          const rData = roomDoc.data();
          if (!rData.player1) transaction.update(roomRef, { status: 'playing', player1: user.uid, player1Data: { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } });
          else transaction.update(roomRef, { status: 'playing', player2: user.uid, player2Data: { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } });
          joined = true;
        }
      });
      if (joined) { setGameId(gameId); setPlayMode(mode); } 
      else { triggerCommError("部屋がキャンセルされたか、開始済です。"); setPlayMode(null); setCurrentTab('home'); }
    } catch (e) { triggerCommError(); setPlayMode(null); setCurrentTab('home'); }
  };

  const declineInvitation = async () => { setIncomingInvitation(null); await updateDoc(getLeaderboardRef(user.uid), { invitation: null }).catch(()=>{}); };

  // --- Leaderboard & AI Match Simulation ---
  useEffect(() => {
    if (!user || isFirstLogin) return; 
    const unsubscribe = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard'), (snap) => {
      let data = []; snap.forEach(doc => data.push(doc.data())); data.sort((a, b) => b.rating - a.rating);
      setLeaderboardData(data);
      
      const myIndex = data.findIndex(d => d.uid === user.uid);
      if (myIndex !== -1) {
        const myRank = myIndex + 1; setCurrentRank(myRank); const myLbData = data[myIndex];
        setProfile(prev => { if (!prev.highestRank || myRank < prev.highestRank) { updateDoc(getProfileRef(user.uid), { highestRank: myRank }).catch(()=>{}); return { ...prev, highestRank: myRank }; } return prev; });
        if (myLbData.dailyDate !== todayStr) {
          setDoc(getLeaderboardRef(user.uid), { dailyDate: todayStr, dailyRating: myLbData.rating, dailyRank: myRank }, { merge: true }).catch(()=>{});
          setDailyStats({ rankDiff: 0, ratingDiff: 0 });
          setProfile(prev => {
            const newRecord = { date: myLbData.dailyDate, rating: myLbData.rating, rank: myRank };
            const newHistory = [...(prev.ratingHistory || []), newRecord].slice(-10);
            updateDoc(getProfileRef(user.uid), { ratingHistory: newHistory }).catch(()=>{});
            return { ...prev, ratingHistory: newHistory };
          });
        } else setDailyStats({ rankDiff: myLbData.dailyRank ? myLbData.dailyRank - myRank : 0, ratingDiff: myLbData.dailyRating ? myLbData.rating - myLbData.dailyRating : 0 });
      }
      data.forEach((u, idx) => {
        if (u.uid !== user?.uid && (u.dailyDate !== todayStr || !u.dailyRank)) setTimeout(() => { updateDoc(getLeaderboardRef(u.uid), { dailyDate: todayStr, dailyRating: u.rating, dailyRank: idx + 1 }, { merge: true }).catch(()=>{}); }, Math.random() * 8000 + 2000);
      });
    }, (err) => { triggerCommError(); });

    const interval = setInterval(async () => {
      try {
        if (Math.random() < 0.60) { 
          const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard'));
          let aiList = []; snap.forEach(d => { const data = d.data(); if(data.uid?.startsWith('ai_bot_') && data.status === 'online' && data.resetVersion === RESET_VERSION) aiList.push(data); });
          for (let pair = 0; pair < 2; pair++) {
            if (aiList.length >= 2) {
              const a1 = aiList.splice(Math.floor(Math.random() * aiList.length), 1)[0];
              let suitable = aiList.filter(ai => Math.abs(ai.rating - a1.rating) < 800);
              let a2 = suitable.length > 0 ? suitable[Math.floor(Math.random() * suitable.length)] : aiList[Math.floor(Math.random() * aiList.length)];
              if (!a2 || (Math.abs(a1.rating - a2.rating) >= 800 && Math.random() < 0.8)) continue;
              aiList = aiList.filter(ai => ai.uid !== a2.uid);
              
              await updateDoc(getLeaderboardRef(a1.uid), { status: 'playing' }).catch(()=>{});
              await updateDoc(getLeaderboardRef(a2.uid), { status: 'playing' }).catch(()=>{});

              setTimeout(async () => {
                let p1 = { rating: a1.rating, currentStreak: 0, highestRating: 1000, wins: 0, losses: 0, draws: 0 };
                let p2 = { rating: a2.rating, currentStreak: 0, highestRating: 1000, wins: 0, losses: 0, draws: 0 };
                try {
                  const [s1, s2] = await Promise.all([getDoc(getProfileRef(a1.uid)), getDoc(getProfileRef(a2.uid))]);
                  if (s1.exists()) p1 = { ...p1, ...s1.data() }; if (s2.exists()) p2 = { ...p2, ...s2.data() };
                } catch(e) {}
                const isA1Win = Math.random() < (1 / (1 + Math.pow(10, (p2.rating - p1.rating) / 400)));
                const isDraw = Math.random() < 0.05;
                const mSt = isDraw ? 32 : (isA1Win ? 34 + Math.floor(Math.random()*15) : 30 - Math.floor(Math.random()*15));
                const oSt = 64 - mSt;

                const ups = [
                  {uid:a1.uid, change:calcRatingChange(p1.rating, p2.rating, mSt, oSt, isA1Win&&!isDraw, isDraw, p1.currentStreak, true, p2.currentStreak), w:isA1Win&&!isDraw, d:isDraw, p: p1}, 
                  {uid:a2.uid, change:calcRatingChange(p2.rating, p1.rating, oSt, mSt, !isA1Win&&!isDraw, isDraw, p2.currentStreak, true, p1.currentStreak), w:!isA1Win&&!isDraw, d:isDraw, p: p2}
                ];
                for (let t of ups) {
                   const nR = Math.max(0, (t.p.rating || 1000) + t.change), nH = Math.max(t.p.highestRating || 1000, nR), nS = t.w ? (t.p.currentStreak || 0) + 1 : 0;
                   const obj = { rating: nR, status: 'online', highestRating: nH, currentStreak: nS, wins: (t.p.wins || 0) + (t.w ? 1 : 0), losses: (t.p.losses || 0) + (!t.w && !t.d ? 1 : 0), draws: (t.p.draws || 0) + (t.d ? 1 : 0) };
                   await updateDoc(getLeaderboardRef(t.uid), obj).catch(()=>{});
                   try { await updateDoc(getProfileRef(t.uid), obj); } catch(e) {} 
                }
              }, 4000); 
            }
          }
        }
      } catch(e) {}
    }, 10000);
    return () => { unsubscribe(); clearInterval(interval); };
  // eslint-disable-next-line
  }, [user, isFirstLogin, todayStr]);

  // --- Game Sync & Events ---
  useEffect(() => {
    if (!user || !gameId || playMode === 'local' || playMode === 'research' || playMode === 'history_analysis') return;
    const unsubscribe = onSnapshot(getGameRef(gameId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (typeof data.board === 'string') data.board = JSON.parse(data.board);
        if (data.status === 'playing' && (!data.player1 || !data.player2 || !data.player1Data || !data.player2Data)) { triggerCommError(); handleLeaveGame(); return; }
        setGameState(data);
      } else { triggerCommError(); handleLeaveGame(); }
    }, (err) => { triggerCommError(); handleLeaveGame(); });
    return () => unsubscribe();
  // eslint-disable-next-line
  }, [user, gameId, playMode]);

  useEffect(() => {
    if (gameState?.status === 'playing' && matchTimeoutId) { clearTimeout(matchTimeoutId); setMatchTimeoutId(null); }
  }, [gameState?.status, matchTimeoutId]);

  useEffect(() => {
    if (gameState?.stamp && Date.now() - gameState.stamp.time < 5000) {
      setActiveStamp(gameState.stamp); const tid = setTimeout(() => setActiveStamp(null), 4000); return () => clearTimeout(tid);
    }
  }, [gameState?.stamp]);

  useEffect(() => {
    if (gameState?.passEvent && Date.now() - gameState.passEvent.time < 2000) {
      setToastMessage(`${gameState.passEvent.color === 'black' ? '黒' : '白'}は置ける場所がないためパスしました！`);
      const tid = setTimeout(() => setToastMessage(null), 1500); return () => clearTimeout(tid);
    }
  }, [gameState?.passEvent]);

  // --- AI Analysis Logic ---
  useEffect(() => {
    if (isAnalysisMode && gameState && gameState.status === 'playing') {
      setResearchData(prev => ({ ...prev, isAnalyzing: true, actualMoveEval: null }));
      const timerId = setTimeout(() => {
        let emptyCount = 0;
        gameState.board.forEach(row => row.forEach(cell => { if (cell === null) emptyCount++; }));
        
        let targetDepth = isDeepAnalysis ? 15 : 6; 
        if (!isDeepAnalysis && emptyCount <= 10) targetDepth = emptyCount;

        const moves = getSimulatedMoves(gameState.board, gameState.turn);
        if (moves.length === 0) {
          const { black, white } = countStones(gameState.board);
          const mC = gameState.turn === 'black' ? black : white, oC = gameState.turn === 'black' ? white : black;
          let evaluation = mC > oC ? 500 : (mC < oC ? -500 : 0);
          setResearchData({ topMoves: [], evaluation, isAnalyzing: false, actualMoveEval: null });
          const turnIndex = playMode === 'history_analysis' ? analysisIndex : localHistory.length - 1;
          const evalForBlack = gameState.turn === 'black' ? evaluation : -evaluation;
          setEvalHistory(prev => { const n = [...prev]; n[turnIndex] = clampScore(evalForBlack); return n; });
          return;
        }
        
        let evaluatedMoves = [], bestEvaluatedMoves = [];
        const endTime = isDeepAnalysis ? Date.now() + 14000 : Date.now() + 2000; 
        
        const sortedMvs = [...moves].map(mv => {
           let tempB = gameState.board.map(r=>[...r]);
           tempB[mv.r][mv.c] = gameState.turn;
           mv.flips.forEach(([fr, fc]) => tempB[fr][fc] = gameState.turn);
           return { ...mv, pre: evaluateBoard(tempB, gameState.turn) };
        }).sort((a,b)=>b.pre - a.pre);

        try {
          const startDepth = isDeepAnalysis ? 4 : targetDepth;
          for (let d = startDepth; d <= targetDepth; d++) {
            let tempEvals = [];
            for (let move of sortedMvs) {
              let newBoard = gameState.board.map(r => [...r]);
              newBoard[move.r][move.c] = gameState.turn;
              move.flips.forEach(([fr, fc]) => newBoard[fr][fc] = gameState.turn);
              let score = minimax(newBoard, d - 1, -Infinity, Infinity, false, gameState.turn === 'black' ? 'white' : 'black', gameState.turn, endTime);
              tempEvals.push({ ...move, score: clampScore(score) });
            }
            tempEvals.sort((a, b) => b.score - a.score);
            bestEvaluatedMoves = tempEvals;
            if (bestEvaluatedMoves[0].score === 500 || bestEvaluatedMoves[0].score === -500) { if (d >= emptyCount) break; }
          }
          evaluatedMoves = bestEvaluatedMoves;
        } catch (e) {
          evaluatedMoves = bestEvaluatedMoves;
          if (evaluatedMoves.length === 0) evaluatedMoves = sortedMvs.map(m => ({ ...m, score: clampScore(m.pre) }));
        }
        
        let evaluation = evaluatedMoves.length > 0 ? evaluatedMoves[0].score : 0;
        let actualMoveEval = null;
        if (playMode === 'history_analysis' && analysisIndex < analysisHistory.length - 1) {
           const actualMove = getMoveFromBoards(gameState.board, analysisHistory[analysisIndex + 1], gameState.turn);
           if (actualMove) {
              const matched = evaluatedMoves.find(m => m.r === actualMove.r && m.c === actualMove.c);
              if (matched) {
                 const diff = evaluation - matched.score;
                 let judgment = diff === 0 ? '最善手' : diff <= 5 ? '好手' : diff <= 15 ? '疑問手' : '悪手';
                 actualMoveEval = { ...matched, judgment, diff };
              } else {
                 let newBoard = gameState.board.map(r => [...r]);
                 newBoard[actualMove.r][actualMove.c] = gameState.turn;
                 getFlippableStones(gameState.board, actualMove.r, actualMove.c, gameState.turn).forEach(([fr, fc]) => newBoard[fr][fc] = gameState.turn);
                 let sc = clampScore(minimax(newBoard, 2, -Infinity, Infinity, false, gameState.turn === 'black' ? 'white' : 'black', gameState.turn, Date.now() + 1000));
                 const diff = evaluation - sc;
                 let judgment = diff <= 5 ? '疑問手' : diff <= 15 ? '悪手' : '大悪手';
                 actualMoveEval = { r: actualMove.r, c: actualMove.c, score: sc, judgment, diff };
              }
           }
        }

        setResearchData({ topMoves: evaluatedMoves.slice(0, 3), evaluation, isAnalyzing: false, actualMoveEval });
        const turnIndex = playMode === 'history_analysis' ? analysisIndex : localHistory.length - 1;
        const evalForBlack = gameState.turn === 'black' ? evaluation : -evaluation;
        setEvalHistory(prev => { const n = [...prev]; n[turnIndex] = clampScore(evalForBlack); return n; });

      }, 50); 
      return () => clearTimeout(timerId);
    }
  // eslint-disable-next-line
  }, [gameState?.board, gameState?.turn, playMode, isDeepAnalysis, analysisIndex, gameState?.allowAiAnalysis]);

  // --- AI Turn Execution ---
  useEffect(() => {
    if (!gameState || gameState.status !== 'playing' || playMode !== 'ranked') return;
    const aiId = gameState.turn === 'black' ? gameState.player1 : gameState.player2;
    if (aiId?.startsWith('ai_bot_') && (gameState.player1 === user?.uid || gameState.player2 === user?.uid)) {
      const aiData = gameState.turn === 'black' ? gameState.player1Data : gameState.player2Data;
      const depth = getAiDepth(aiData?.rating || 1000, aiId.includes('_strong_'));
      const timer = setTimeout(() => {
        const moveStr = getBestMove(gameState.board, gameState.turn, depth);
        if (moveStr) {
          const [r, c] = moveStr.split(',').map(Number); handleMove(r, c, gameState.turn);
        } else {
           if (getValidMoves(gameState.board, gameState.turn).length === 0) {
              const nextTurn = gameState.turn === 'black' ? 'white' : 'black';
              let nextStatus = 'playing'; if (getValidMoves(gameState.board, nextTurn).length === 0) nextStatus = 'finished';
              updateDoc(getGameRef(gameId), { turn: nextTurn, status: nextStatus, passEvent: { color: gameState.turn, time: Date.now() } }).catch(()=>{});
           }
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line
  }, [gameState?.board, gameState?.turn, gameState?.status, user, playMode, gameId]);

  // --- Game Finish Processing ---
  useEffect(() => {
    if (!user || !gameState || gameState.status !== 'finished' || playMode !== 'ranked') return;
    if (gameState.resultProcessedBy?.includes(user.uid)) return; 
    const isP1 = gameState.player1 === user.uid, isP2 = gameState.player2 === user.uid;
    if (!isP1 && !isP2) return;

    const processResult = async () => {
      try {
        const myColor = isP1 ? 'black' : 'white';
        const { black, white } = countStones(gameState.board);
        const myStones = myColor === 'black' ? black : white, oppStones = myColor === 'black' ? white : black;
        let isWin = false, isDraw = false;
        if (gameState.resignedBy) isWin = gameState.resignedBy !== user.uid;
        else { if (myStones > oppStones) isWin = true; else if (myStones === oppStones) isDraw = true; }

        const oppData = isP1 ? gameState.player2Data : gameState.player1Data;
        const currentProfile = (await getDoc(getProfileRef(user.uid))).exists() ? (await getDoc(getProfileRef(user.uid))).data() : profile;

        const change = calcRatingChange(currentProfile.rating || 1000, oppData?.rating || 1000, myStones, oppStones, isWin, isDraw, currentProfile.currentStreak || 0, false, oppData?.currentStreak || 0);
        setLastMatchChange(change);
        const newRating = Math.max(0, (currentProfile.rating || 1000) + change);
        
        const historyItem = { 
          id: Date.now(), oppName: oppData?.name || '対戦相手', result: isDraw ? 'draw' : (isWin ? 'win' : 'loss'), 
          change, myStones, oppStones, date: new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          boardHistory: gameState.boardHistory || [], turnHistory: gameState.turnHistory || []
        };

        await updateProfile({
          rating: newRating, highestRating: Math.max(currentProfile.highestRating || 1000, newRating), 
          currentStreak: isWin && !isDraw ? (currentProfile.currentStreak || 0) + 1 : 0,
          wins: (currentProfile.wins || 0) + (isWin && !isDraw ? 1 : 0), losses: (currentProfile.losses || 0) + (!isWin && !isDraw ? 1 : 0), draws: (currentProfile.draws || 0) + (isDraw ? 1 : 0), 
          history: [historyItem, ...(currentProfile.history || [])].slice(0, 10)
        });

        const oppUid = isP1 ? gameState.player2 : gameState.player1;
        if (oppUid?.startsWith('ai_bot_')) {
           try {
             const aiLbSnap = await getDoc(getLeaderboardRef(oppUid));
             let curAiR = 1000; if (aiLbSnap.exists()) curAiR = aiLbSnap.data().rating;
             const aiSnap = await getDoc(getProfileRef(oppUid));
             let aiCSt = 0, aiP = null; if(aiSnap.exists()) { aiP = aiSnap.data(); aiCSt = aiP.currentStreak || 0; }

             const aiCg = calcRatingChange(curAiR, currentProfile.rating || 1000, oppStones, myStones, !isWin && !isDraw, isDraw, aiCSt, true, currentProfile.currentStreak || 0);
             const nAiR = Math.max(0, curAiR + aiCg), nAiH = Math.max(aiP?.highestRating || 1000, nAiR), nAiC = (!isWin && !isDraw) ? aiCSt + 1 : 0;
             const nWs = (aiP?.wins || 0) + (!isWin && !isDraw ? 1 : 0), nLs = (aiP?.losses || 0) + (isWin && !isDraw ? 1 : 0), nDs = (aiP?.draws || 0) + (isDraw ? 1 : 0);

             await updateDoc(getLeaderboardRef(oppUid), { rating: nAiR, status: 'online', highestRating: nAiH, currentStreak: nAiC, wins: nWs, losses: nLs, draws: nDs }).catch(()=>{});
             if(aiP) await updateDoc(getProfileRef(oppUid), { rating: nAiR, highestRating: nAiH, currentStreak: nAiC, wins: nWs, losses: nLs, draws: nDs, history: [historyItem, ...(aiP.history || [])].slice(0, 10) });
           } catch(e) {}
        }
        await updateDoc(getGameRef(gameId), { resultProcessedBy: arrayUnion(user.uid) });
      } catch (err) { triggerCommError(); }
    };
    processResult();
  // eslint-disable-next-line
  }, [gameState?.status]);

  // --- Modes & Matchmaking Functions ---
  const startResearchMode = () => {
    setToastMessage(null); setLastMatchChange(null);
    const iB = INITIAL_BOARD.map(r => [...r]);
    setGameState({ status: 'playing', board: iB, turn: 'black', player1Data: { name: 'Player(黒)' }, player2Data: { name: 'Player(白)' }, boardHistory: [JSON.stringify(iB)], turnHistory: ['black'] });
    setLocalHistory([iB]); setPlayMode('research'); setCurrentTab('play');
    setResearchData({ topMoves: [], evaluation: 0, isAnalyzing: true, actualMoveEval: null }); setIsDeepAnalysis(false); setEvalHistory([]);
  };

  const startHistoryAnalysis = (item) => {
    if (!item.boardHistory || item.boardHistory.length === 0) { triggerCommError("この対局の棋譜データがありません。"); return; }
    const pHist = item.boardHistory.map(b => JSON.parse(b));
    setAnalysisHistory(pHist); setAnalysisTurnHistory(item.turnHistory || pHist.map((_, i) => i % 2 === 0 ? 'black' : 'white')); setAnalysisIndex(0);
    setGameState({ status: 'playing', board: pHist[0], turn: item.turnHistory ? item.turnHistory[0] : 'black', player1Data: { name: '黒(先手)' }, player2Data: { name: '白(後手)' } });
    setPlayMode('history_analysis'); setCurrentTab('play');
    setResearchData({ topMoves: [], evaluation: 0, isAnalyzing: true, actualMoveEval: null }); setIsDeepAnalysis(false); setEvalHistory([]);
  };

  const changeAnalysisIndex = (nIdx) => {
    setAnalysisIndex(nIdx); setGameState(p => ({ ...p, board: analysisHistory[nIdx], turn: analysisTurnHistory[nIdx] || 'black' }));
    setResearchData({ topMoves: [], evaluation: 0, isAnalyzing: true, actualMoveEval: null });
  };

  const startAiMatchImmediately = async (gid) => {
    if (matchTimeoutId) { clearTimeout(matchTimeoutId); setMatchTimeoutId(null); }
    try {
      const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard'));
      let aiList = []; snap.forEach(d => { const data = d.data(); if(data.uid?.startsWith('ai_bot_') && data.resetVersion === RESET_VERSION) aiList.push(data); });
      let stAIs = aiList.filter(ai => Math.abs(ai.rating - profile.rating) < 800);
      if (stAIs.length === 0) stAIs = aiList; 
      let selAI = stAIs[Math.floor(Math.random() * stAIs.length)];
      if (!selAI) {
         const isSt = Math.random() < (4/24), idx = isSt ? Math.floor(Math.random() * 4) : Math.floor(Math.random() * 20);
         selAI = { uid: isSt ? `ai_bot_strong_${idx}` : `ai_bot_${idx}`, name: isSt ? `AI-Master-${idx+1}` : `AI-Player-${idx+1}`, rating: 1000 };
      }
      const aiId = selAI.uid;
      let aiData = { name: selAI.name, rating: selAI.rating, highestRating: 1000, wins: 0, losses: 0, draws: 0, currentStreak: 0 };
      const aiSn = await getDoc(getProfileRef(aiId)); if (aiSn.exists()) aiData = { ...aiData, ...aiSn.data() };
      const gSn = await getDoc(getGameRef(gid)); const gDt = gSn.exists() ? gSn.data() : {};
      const isP1 = gDt.player1 === user.uid;
      await updateDoc(getGameRef(gid), { 
        status: 'playing', 
        player1: isP1 ? user.uid : aiId, player1Data: isP1 ? gDt.player1Data : { name: aiData.name, rating: aiData.rating, highestRating: aiData.highestRating, wins: aiData.wins||0, losses: aiData.losses||0, draws: aiData.draws||0, currentStreak: aiData.currentStreak || 0 },
        player2: isP1 ? aiId : user.uid, player2Data: !isP1 ? gDt.player2Data : { name: aiData.name, rating: aiData.rating, highestRating: aiData.highestRating, wins: aiData.wins||0, losses: aiData.losses||0, draws: aiData.draws||0, currentStreak: aiData.currentStreak || 0 } 
      });
    } catch (e) { triggerCommError(); setPlayMode(null); setCurrentTab('home'); }
  };

  const startRankedMatch = async () => {
    if (!user) return;
    setToastMessage(null); setLastMatchChange(null);
    if (matchTimeoutId) { clearTimeout(matchTimeoutId); setMatchTimeoutId(null); }
    setPlayMode('matching'); setCurrentTab('play');
    try {
      const snap = await getDocs(getGamesCollection());
      let fG = null, bG = null, now = Date.now();
      snap.forEach(doc => {
        const data = doc.data();
        if (data.status === 'waiting' && data.gameType === 'ranked') {
          if (data.createdAt && (now - data.createdAt > 20000)) deleteDoc(getGameRef(doc.id)).catch(()=>{});
          else {
            const opR = data.player1Data ? data.player1Data.rating : (data.player2Data ? data.player2Data.rating : 1000);
            const opU = data.player1 || data.player2;
            if (opU && opU !== user.uid) { if (Math.abs(opR - profile.rating) < 800) fG = { id: doc.id, ...data }; else bG = { id: doc.id, ...data }; }
          }
        }
      });
      if (!fG && bG && Math.random() < 0.1) fG = bG;
      let joined = false;
      if (fG) {
        try {
          await runTransaction(db, async (t) => {
            const d = await t.get(getGameRef(fG.id));
            if (d.exists() && d.data().status === 'waiting') {
              if (!d.data().player1) t.update(getGameRef(fG.id), { status: 'playing', player1: user.uid, player1Data: { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } });
              else t.update(getGameRef(fG.id), { status: 'playing', player2: user.uid, player2Data: { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } });
              joined = true;
            }
          });
        } catch(e) {}
      }
      if (joined) { setGameId(fG.id); setPlayMode('ranked'); } 
      else {
        const iB = INITIAL_BOARD.map(r => [...r]), isP1 = Math.random() < 0.5;
        const ref = await addDoc(getGamesCollection(), {
          gameType: 'ranked', status: 'waiting', board: JSON.stringify(iB), turn: 'black', boardHistory: [JSON.stringify(iB)], turnHistory: ['black'],
          player1: isP1 ? user.uid : null, player1Data: isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : null, 
          player2: !isP1 ? user.uid : null, player2Data: !isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : null, 
          resultProcessedBy: [], createdAt: Date.now()
        });
        setGameId(ref.id); setPlayMode('ranked');
        const tid = setTimeout(async () => {
          try { const c = await getDoc(getGameRef(ref.id)); if(c.exists() && c.data().status === 'waiting') await startAiMatchImmediately(ref.id); } catch(e){}
        }, 20000);
        setMatchTimeoutId(tid);
      }
    } catch (e) { triggerCommError(); setPlayMode(null); setCurrentTab('home'); }
  };

  const joinRoom = async (roomPin) => {
    if (!user || roomPin.length !== 4) return;
    setToastMessage(null); setLastMatchChange(null); setShowRoomModal(false); setPlayMode('matching'); setCurrentTab('play');
    const roomRef = getGameRef(roomPin);
    try {
      let role = '';
      await runTransaction(db, async (t) => {
        const d = await t.get(roomRef);
        if (!d.exists()) {
          const initB = INITIAL_BOARD.map(r => [...r]), isP1 = Math.random() < 0.5;
          t.set(roomRef, { 
            gameType: 'room', status: 'waiting', board: JSON.stringify(initB), turn: 'black', boardHistory: [JSON.stringify(initB)], turnHistory: ['black'],
            player1: isP1 ? user.uid : null, player1Data: isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : null, 
            player2: !isP1 ? user.uid : null, player2Data: !isP1 ? { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } : null, 
            createdAt: Date.now(), allowAiAnalysis 
          });
          role = 'player';
        } else {
          const data = d.data();
          if (data.status === 'waiting' && (!data.player1 || !data.player2)) {
             if (!data.player1 && data.player2 !== user.uid) { t.update(roomRef, { status: 'playing', player1: user.uid, player1Data: { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } }); role = 'player'; }
             else if (!data.player2 && data.player1 !== user.uid) { t.update(roomRef, { status: 'playing', player2: user.uid, player2Data: { name: profile.name, rating: profile.rating, currentStreak: profile.currentStreak || 0 } }); role = 'player'; }
          } else if (data.player1 === user.uid || data.player2 === user.uid) role = 'player';
          else role = 'spectator';
        }
      });
      setGameId(roomPin); setPlayMode(role === 'player' ? 'room' : 'room_spectator');
    } catch (e) { triggerCommError("入室時に通信エラーが発生しました。"); setPlayMode(null); setCurrentTab('home'); }
  };

  const startLocalMatch = () => {
    setToastMessage(null); setLastMatchChange(null);
    const initB = INITIAL_BOARD.map(r => [...r]);
    setGameState({ status: 'playing', board: initB, turn: 'black', player1Data: { name: 'Player 1' }, player2Data: { name: 'Player 2' } });
    setLocalHistory([initB]); setPlayMode('local'); setCurrentTab('play');
  };

  const handleMove = async (row, col, forceColor = null) => {
    if (!gameState || gameState.status !== 'playing' || playMode === 'room_spectator' || playMode === 'history_analysis') return;
    let myColor = forceColor || ((playMode === 'local' || playMode === 'research') ? gameState.turn : (gameState.player1 === user.uid ? 'black' : 'white'));
    if (!forceColor && gameState.turn !== myColor) return;
    const flips = getFlippableStones(gameState.board, row, col, myColor);
    if (flips.length === 0) return;

    let nB = gameState.board.map(r => [...r]); nB[row][col] = myColor; flips.forEach(([r, c]) => nB[r][c] = myColor);
    let nT = myColor === 'black' ? 'white' : 'black', nS = 'playing', pEv = null;

    if (getValidMoves(nB, nT).length === 0) {
      pEv = { color: nT, time: Date.now() }; nT = myColor;
      if (getValidMoves(nB, nT).length === 0) nS = 'finished';
    }

    let nBH = [...(gameState.boardHistory || [JSON.stringify(INITIAL_BOARD)]), JSON.stringify(nB)];
    let nTH = [...(gameState.turnHistory || ['black']), nT];

    if (playMode === 'local' || playMode === 'research') {
      setLocalHistory([...localHistory, nB]);
      setGameState({ ...gameState, board: nB, turn: nT, status: nS, passEvent: pEv, boardHistory: nBH, turnHistory: nTH });
    } else {
      setGameState({ ...gameState, board: nB, turn: nT, status: nS, passEvent: pEv, boardHistory: nBH, turnHistory: nTH }); 
      await updateDoc(getGameRef(gameId), { board: JSON.stringify(nB), boardHistory: nBH, turnHistory: nTH, turn: nT, status: nS, passEvent: pEv }).catch(()=>{});
    }
  };

  const handleStamp = async (text) => {
    if (!gameId || playMode === 'local' || playMode === 'research' || playMode === 'history_analysis' || playMode === 'room_spectator') return;
    await updateDoc(getGameRef(gameId), { stamp: { sender: user.uid, text, time: Date.now() } }).catch(()=>{}); setShowStampMenu(false);
  };

  const handleLeaveGame = async () => {
    setToastMessage(null); setLastMatchChange(null);
    if (matchTimeoutId) { clearTimeout(matchTimeoutId); setMatchTimeoutId(null); }
    if (gameId && playMode === 'ranked') {
      if (gameState?.status === 'waiting' || !gameState) { deleteDoc(getGameRef(gameId)).catch(()=>{}); } 
      else if (gameState?.status === 'playing') {
        try { 
          const opD = (gameState.player1 === user.uid) ? gameState.player2Data : gameState.player1Data;
          const cP = (await getDoc(getProfileRef(user.uid))).exists() ? (await getDoc(getProfileRef(user.uid))).data() : profile;
          const cg = calcRatingChange(cP.rating || 1000, opD?.rating || 1000, 0, 64, false, false, cP.currentStreak || 0, false, opD?.currentStreak || 0);
          const nR = Math.max(0, (cP.rating || 1000) + cg);
          const hItm = { id: Date.now(), oppName: opD?.name || '対戦相手', result: 'loss', change: cg, myStones: 0, oppStones: 64, date: new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), boardHistory: gameState.boardHistory || [], turnHistory: gameState.turnHistory || [] };
          await updateProfile({ rating: nR, currentStreak: 0, losses: (cP.losses || 0) + 1, history: [hItm, ...(cP.history || [])].slice(0, 10) });
          await updateDoc(getGameRef(gameId), { status: 'finished', resignedBy: user.uid, resultProcessedBy: arrayUnion(user.uid) }).catch(()=>{}); 
        } catch (e) {}
      }
    }
    setPlayMode(null); setGameId(null); setGameState(null); setCurrentTab('home'); setShowLeaveAlert(false);
  };

  // --- Renderers ---
  const renderHome = () => (
    <div className="p-4 space-y-5 flex flex-col min-h-full animate-in fade-in duration-300">
      <div className={`p-6 rounded-2xl text-white shadow-lg flex flex-col items-center justify-center space-y-2 ${activeTheme.primary}`}><h2 className="text-3xl font-black tracking-wider">REVERSI</h2></div>
      <div className="space-y-3 flex-1">
        <button onClick={startRankedMatch} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform"><div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><Swords size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ランク戦</h3><p className="text-xs text-gray-500">レートを懸けた真剣勝負</p></div></div><ChevronRight size={20} className="text-gray-400" /></button>
        <button onClick={() => setShowRoomModal(true)} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform"><div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><Hash size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ルーム戦</h3><p className="text-xs text-gray-500">PINコードで友達と対戦・観戦</p></div></div><ChevronRight size={20} className="text-gray-400" /></button>
        <button onClick={startLocalMatch} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform"><div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><Users size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ローカル対戦</h3><p className="text-xs text-gray-500">1台の端末で2人プレイ</p></div></div><ChevronRight size={20} className="text-gray-400" /></button>
        <button onClick={startResearchMode} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform"><div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><Bot size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">AI研究モード</h3><p className="text-xs text-gray-500">AIが最善手をリアルタイム解析</p></div></div><ChevronRight size={20} className="text-gray-400" /></button>
        <button onClick={() => setShowLeaderboard(true)} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform"><div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><BarChart2 size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ランキング</h3><p className="text-xs text-gray-500">トッププレイヤーと順位変動</p></div></div><ChevronRight size={20} className="text-gray-400" /></button>
      </div>

      {showRoomModal && (
        <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-xs space-y-4">
            <h3 className="font-bold text-center text-gray-800">ルームナンバー入力</h3>
            <p className="text-xs text-center text-gray-500">4桁の数字を入力して入室します。<br/>3人目以降は観戦になります。</p>
            <input type="text" inputMode="numeric" pattern="\d*" maxLength={4} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0000" className="w-full text-center text-3xl tracking-[0.5em] font-mono p-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <div className="flex items-center justify-center mt-2"><input type="checkbox" id="allowAi" checked={allowAiAnalysis} onChange={(e) => setAllowAiAnalysis(e.target.checked)} className="mr-2" /><label htmlFor="allowAi" className="text-xs font-bold text-gray-600 cursor-pointer select-none">AI解析を許可する（ホストのみ）</label></div>
            <div className="flex space-x-3 pt-2"><button onClick={() => setShowRoomModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold">キャンセル</button><button onClick={() => joinRoom(roomNumber)} disabled={roomNumber.length !== 4} className={`flex-1 py-3 text-white rounded-xl font-bold disabled:opacity-50 ${activeTheme.primary}`}>入室</button></div>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50 animate-in fade-in">
          <div className="bg-white w-full h-[85%] rounded-t-3xl shadow-xl flex flex-col animate-in slide-in-from-bottom-full duration-300">
            <div className="p-4 flex justify-between items-center border-b border-gray-100"><h2 className="text-xl font-black flex items-center"><Trophy className="text-yellow-500 mr-2"/> ランキング</h2><button onClick={() => setShowLeaderboard(false)} className="p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200"><X size={20}/></button></div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {leaderboardData.slice(0, 30).map((lbUser, idx) => {
                const rDiff = lbUser.dailyDate === todayStr && lbUser.dailyRank ? lbUser.dailyRank - (idx + 1) : 0;
                const rateDiff = lbUser.dailyDate === todayStr && lbUser.dailyRating !== undefined ? lbUser.rating - lbUser.dailyRating : 0;
                return (
                  <div key={lbUser.uid} onClick={() => handleUserClick(lbUser)} className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer hover:bg-gray-50 transition-colors ${lbUser.uid === user?.uid ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-200 hover:bg-blue-50' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <div className="flex items-center space-x-3 flex-1"><div className="flex flex-col items-center justify-center w-8"><span className={`font-black text-lg leading-none mb-0.5 ${idx===0 ? 'text-yellow-500' : idx===1 ? 'text-gray-400' : idx===2 ? 'text-amber-600' : 'text-gray-300'}`}>{idx+1}</span>{renderDiff('rank', rDiff)}</div><div className="flex items-center space-x-2"><div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(lbUser.status)} shadow-sm`}></div><div className="font-bold text-gray-800 truncate pr-2 max-w-[100px]">{lbUser.name}</div></div></div>
                    <div className="flex flex-col items-end"><div className={`font-black px-3 py-1 rounded-full text-sm ${getRankStyle(lbUser.rating)}`}>{lbUser.rating}</div><div className="mt-1">{renderDiff('rating', rateDiff)}</div></div>
                    {lbUser.uid !== user?.uid && <button onClick={(e) => { e.stopPropagation(); toggleFriend(lbUser.uid); }} className="ml-2 p-1.5 rounded-full hover:bg-gray-200 transition-colors">{profile.friends?.includes(lbUser.uid) ? <UserMinus size={18} className="text-gray-400" /> : <UserPlus size={18} className={activeTheme.text} />}</button>}
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center rounded-b-3xl">
              <div className="flex flex-col"><span className="text-xs font-bold text-gray-500 mb-1">あなたの現在順位</span><span className="font-bold text-gray-800">{profile.name}</span></div>
              <div className="flex flex-col items-end"><div className="flex items-baseline space-x-2"><span className={`font-black text-2xl ${activeTheme.text}`}>{currentRank ? `${currentRank}位` : '-'}</span><div className="w-8 flex justify-center">{renderDiff('rank', dailyStats.rankDiff)}</div></div><div className="flex items-center space-x-2"><span className="text-xs font-bold text-gray-400">Rate: {profile.rating}</span><div className="w-8 flex justify-center">{renderDiff('rating', dailyStats.ratingDiff)}</div></div></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderFriends = () => {
    const friendList = leaderboardData.filter(u => profile.friends?.includes(u.uid));
    return (
      <div className="p-4 space-y-4 min-h-full animate-in fade-in duration-300">
        <h2 className="text-xl font-black mb-2 text-gray-800 flex items-center"><Users className={`mr-2 ${activeTheme.text}`}/> フレンド ({friendList.length})</h2>
        <div className="space-y-3">
          {friendList.length === 0 ? (
            <div className="text-center py-10 bg-white rounded-2xl border border-gray-100 shadow-sm"><UserPlus size={32} className="mx-auto text-gray-300 mb-2" /><p className="text-gray-400 text-sm font-bold">フレンドはまだいません。</p><p className="text-gray-400 text-xs mt-1">ランキングから「＋」ボタンで追加できます。</p></div>
          ) : (
            friendList.map((fUser) => (
              <div key={fUser.uid} onClick={() => handleUserClick(fUser)} className="flex items-center justify-between p-4 rounded-xl bg-white border border-gray-100 shadow-sm cursor-pointer hover:bg-gray-50 transition-colors">
                <div className="flex items-center space-x-3"><div className={`w-3 h-3 rounded-full ${getStatusColor(fUser.status)} shadow-sm border border-white`}></div><div className="font-bold text-gray-800">{fUser.name}</div></div>
                <div className="flex items-center space-x-3"><span className={`font-black px-3 py-1 rounded-full text-xs ${getRankStyle(fUser.rating)}`}>Rate: {fUser.rating}</span><button onClick={(e) => { e.stopPropagation(); toggleFriend(fUser.uid); }} className="p-2 bg-gray-50 rounded-full text-gray-400 hover:text-red-500 transition-colors"><UserMinus size={16} /></button></div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderGame = () => {
    if (playMode === 'matching') return (
      <div className="h-full flex flex-col items-center justify-center space-y-4 px-6 text-center">
        <Loader2 size={40} className={`animate-spin ${activeTheme.text}`} /><p className="font-bold text-gray-600">対戦相手を探しています...</p><p className="text-xs text-gray-400">※20秒経過するとAIプレイヤーと対戦が開始されます。</p>
        {gameId && <button onClick={() => startAiMatchImmediately(gameId)} className={`mt-4 px-6 py-3 text-white font-bold rounded-xl shadow-sm active:scale-95 flex items-center justify-center space-x-2 ${activeTheme.primary}`}><Bot size={20} /><span>今すぐAI対戦</span></button>}
        <button onClick={handleLeaveGame} className="mt-4 px-6 py-2 bg-gray-200 rounded-full text-sm font-bold text-gray-600">キャンセル</button>
      </div>
    );
    if (!gameState) return null;

    const { board, turn, status, player1Data, player2Data, player1, player2, resignedBy } = gameState;
    const { black: bC, white: wC } = countStones(board);
    let myColor = (playMode === 'local' || playMode === 'research' || playMode === 'history_analysis') ? turn : (player1 === user?.uid ? 'black' : 'white');
    let isMyTurn = playMode === 'room_spectator' || playMode === 'history_analysis' ? false : turn === myColor;
    let vMoves = isMyTurn && status === 'playing' ? getValidMoves(board, myColor) : [];

    let win = null;
    if (status === 'finished') {
      if (resignedBy) win = resignedBy === player1 ? 'white' : 'black';
      else win = bC > wC ? 'black' : (wC > bC ? 'white' : 'draw');
    }

    return (
      <div className="p-4 flex flex-col h-full animate-in fade-in duration-300 relative">
        {toastMessage && (<div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-40 animate-in slide-in-from-top-10 fade-in duration-300"><div className="bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg font-bold text-sm flex items-center"><AlertTriangle size={18} className="text-yellow-400 mr-2" /> {toastMessage}</div></div>)}

        <div className="flex items-center justify-between mb-4 shrink-0">
           {playMode !== 'history_analysis' ? ( <button onClick={() => { if(playMode === 'ranked' && status === 'playing') setShowLeaveAlert(true); else handleLeaveGame(); }} className="p-2 bg-white rounded-full shadow-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={20} /></button> ) : ( <button onClick={() => { setPlayMode(null); setCurrentTab('profile'); }} className="p-2 bg-white rounded-full shadow-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={20} /></button> )}
           {playMode === 'room' && <span className="bg-white px-3 py-1 rounded-full text-xs font-bold font-mono tracking-widest shadow-sm">Room: {gameId}</span>}
           {playMode === 'room_spectator' && <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold flex items-center"><Eye size={14} className="mr-1"/> 観戦中</span>}
           {playMode === 'research' && <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold flex items-center"><Bot size={14} className="mr-1"/> 研究モード</span>}
           {playMode === 'history_analysis' && <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold flex items-center"><History size={14} className="mr-1"/> 棋譜解析</span>}
        </div>

        {isAnalysisMode && (
          <div className="bg-white p-3 rounded-xl shadow-sm mb-4 border border-blue-100 flex flex-col shrink-0" style={{ height: playMode === 'history_analysis' ? '216px' : '172px' }}>
            <div className="flex justify-between items-center mb-2 shrink-0 h-6">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-gray-500 flex items-center"><Bot size={14} className="mr-1 text-blue-500"/> AI解析</span>
                <button onClick={() => setIsDeepAnalysis(!isDeepAnalysis)} className={`text-[10px] px-2 py-0.5 rounded font-bold transition-colors ${isDeepAnalysis ? 'bg-indigo-500 text-white shadow-inner' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>超解析 (15手)</button>
              </div>
              <span className={`text-sm font-black ${researchData.isAnalyzing ? 'text-gray-500' : (turn === 'black' ? researchData.evaluation : -researchData.evaluation) > 0 ? 'text-gray-800' : (turn === 'black' ? researchData.evaluation : -researchData.evaluation) < 0 ? 'text-gray-400' : 'text-gray-500'}`}>形勢: {getEvaluationText()}</span>
            </div>

            {renderEvalGraph()}

            <div className="flex space-x-2 h-[48px] shrink-0 mt-3">
              {researchData.topMoves.map((m, i) => {
                let dSc = clampScore(m.score); if (turn === 'white') dSc = -dSc;
                return ( <div key={i} className={`flex-1 text-center py-1.5 rounded-lg text-xs font-bold shadow-sm border ${i === 0 ? 'bg-red-50 text-red-600 border-red-200' : i === 1 ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-blue-50 text-blue-600 border-blue-200'}`}> {i + 1}位: {String.fromCharCode(65 + m.c)}{m.r + 1} <br/><span className="text-[10px] opacity-70">({dSc > 0 ? '+' : ''}{dSc})</span> </div> );
              })}
              {researchData.topMoves.length === 0 && !researchData.isAnalyzing && <div className="w-full text-center py-2 text-xs text-gray-400 font-bold">候補手なし</div>}
            </div>

            {playMode === 'history_analysis' && (
              <div className="h-[36px] mt-2 shrink-0">
                {researchData.actualMoveEval ? (() => {
                  let dSc = clampScore(researchData.actualMoveEval.score); if (turn === 'white') dSc = -dSc;
                  const jg = researchData.actualMoveEval.judgment;
                  return (
                    <div className={`p-2 rounded-lg text-center text-xs font-bold h-full flex items-center justify-center ${jg === '最善手' ? 'bg-blue-100 text-blue-700' : jg === '好手' ? 'bg-emerald-100 text-emerald-700' : jg === '疑問手' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                      実際の指し手: {String.fromCharCode(65 + researchData.actualMoveEval.c)}{researchData.actualMoveEval.r + 1} <span className="opacity-70 ml-2">({dSc > 0 ? '+' : ''}{dSc} / {jg})</span>
                    </div>
                  );
                })() : <div className="h-full"></div>}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm mb-6 relative shrink-0">
          <div className="absolute top-0 left-0 w-full h-1 bg-gray-100 rounded-t-xl overflow-hidden"><div className={`h-full transition-all duration-500 ${turn === 'black' ? 'bg-black w-1/2' : 'bg-white w-1/2 ml-auto'}`}></div></div>
          
          <div className={`flex flex-col items-center p-2 rounded-lg relative ${turn === 'black' ? activeTheme.light : ''} w-[100px]`}>
            {activeStamp && player1 && activeStamp.sender === player1 && <div className="absolute -top-10 bg-white px-3 py-1.5 rounded-2xl shadow-lg border border-gray-100 text-xs font-bold z-20 whitespace-nowrap animate-in zoom-in slide-in-from-bottom-2 duration-200">{activeStamp.text}<div className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-gray-100 rotate-45"></div></div>}
            <div className="w-8 h-8 bg-black rounded-full shadow-md mb-1 border-2 border-transparent flex items-center justify-center">{player1?.startsWith('ai_bot_') && <span className="text-[10px] text-white font-mono opacity-50">AI</span>}</div>
            <span className="text-xs font-bold truncate w-full text-center">{player1Data?.name}</span>
            {(playMode === 'ranked' || playMode === 'room_spectator') && player1Data && <span className="text-[10px] text-gray-500 font-bold w-full text-center whitespace-nowrap">R:{player1Data?.rating || 1000}{player1Data?.currentStreak >= 2 ? ` 🔥${player1Data.currentStreak}` : ''}</span>}
            <span className="text-xs font-black mt-1">{bC}</span>
          </div>

          <div className="text-center">
            {status === 'waiting' && <span className="text-xs font-bold text-gray-400">参加者を待機中...</span>}
            {status === 'playing' && <span className={`text-sm font-bold ${activeTheme.text}`}>{playMode === 'room_spectator' || playMode === 'history_analysis' ? (turn === 'black' ? '黒の番' : '白の番') : (isMyTurn ? "あなたの番です" : "相手の番です")}</span>}
            {status === 'finished' && <span className="text-sm font-bold text-red-500">決着！</span>}
          </div>

          <div className={`flex flex-col items-center p-2 rounded-lg relative ${turn === 'white' ? activeTheme.light : ''} w-[100px]`}>
            {activeStamp && player2 && activeStamp.sender === player2 && <div className="absolute -top-10 bg-white px-3 py-1.5 rounded-2xl shadow-lg border border-gray-100 text-xs font-bold z-20 whitespace-nowrap animate-in zoom-in slide-in-from-bottom-2 duration-200">{activeStamp.text}<div className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-gray-100 rotate-45"></div></div>}
            <div className="w-8 h-8 bg-white rounded-full shadow-md mb-1 border-2 border-gray-200 flex items-center justify-center">{player2?.startsWith('ai_bot_') && <span className="text-[10px] text-black font-mono opacity-50">AI</span>}</div>
            <span className="text-xs font-bold truncate w-full text-center">{player2Data?.name || '---'}</span>
            {(playMode === 'ranked' || playMode === 'room_spectator') && player2Data && <span className="text-[10px] text-gray-500 font-bold w-full text-center whitespace-nowrap">R:{player2Data?.rating || 1000}{player2Data?.currentStreak >= 2 ? ` 🔥${player2Data.currentStreak}` : ''}</span>}
            <span className="text-xs font-black mt-1">{wC}</span>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center shrink-0">
          <div className={`${activeTheme.board} p-1.5 rounded-lg shadow-2xl w-full max-w-[350px] aspect-square`}>
            <div className={`grid grid-cols-8 grid-rows-8 gap-0.5 h-full w-full ${activeTheme.grid} border-2 ${activeTheme.border}`}>
              {board.map((row, rIdx) => row.map((cell, cIdx) => {
                const isMv = vMoves.includes(`${rIdx},${cIdx}`);
                let rIdx2 = -1; if (isAnalysisMode && !researchData.isAnalyzing) rIdx2 = researchData.topMoves.findIndex(m => m.r === rIdx && m.c === cIdx);
                return (
                  <div key={`${rIdx}-${cIdx}`} onClick={() => isMv && handleMove(rIdx, cIdx)} className={`${activeTheme.cell} w-full h-full flex items-center justify-center relative ${isMv ? 'cursor-pointer hover:brightness-110' : ''}`}>
                    {cell && <div className={`w-[85%] h-[85%] rounded-full shadow-sm transition-all duration-300 transform scale-100 ${cell === 'black' ? 'bg-black' : 'bg-white border-gray-200 border'}`} />}
                    {isMv && rIdx2 === -1 && <div className="w-2.5 h-2.5 bg-black opacity-20 rounded-full"></div>}
                    {rIdx2 !== -1 && <div className={`absolute top-0 right-0 w-3.5 h-3.5 rounded-bl-sm text-[8px] flex items-center justify-center font-black text-white ${rIdx2 === 0 ? 'bg-red-500' : rIdx2 === 1 ? 'bg-orange-500' : 'bg-blue-500'}`}>{rIdx2 + 1}</div>}
                  </div>
                );
              }))}
            </div>
          </div>
        </div>

        {playMode === 'history_analysis' && (
          <div className="mt-6 flex justify-between items-center bg-gray-100 p-2 rounded-xl space-x-2 h-14 shrink-0">
            <button onClick={() => changeAnalysisIndex(analysisIndex - 1)} disabled={analysisIndex <= 0 || researchData.isAnalyzing} className="flex-1 py-2 h-full bg-white rounded-lg shadow-sm font-bold text-gray-600 active:scale-95 disabled:opacity-50">＜ 前の手</button>
            <div className="font-black text-gray-600 text-sm px-4 whitespace-nowrap">{analysisIndex}手目</div>
            <button onClick={() => changeAnalysisIndex(analysisIndex + 1)} disabled={analysisIndex >= analysisHistory.length - 1 || researchData.isAnalyzing} className="flex-1 py-2 h-full bg-white rounded-lg shadow-sm font-bold text-gray-600 active:scale-95 disabled:opacity-50">次の手 ＞</button>
          </div>
        )}

        {playMode !== 'history_analysis' && (
          <div className="mt-6 flex space-x-3 relative shrink-0">
            {(playMode === 'ranked' || playMode === 'room') && status === 'playing' && (
              <div className="relative">
                <button onClick={() => setShowStampMenu(!showStampMenu)} className="bg-white text-gray-500 p-3 rounded-xl shadow-sm active:scale-95 border border-gray-100"><MessageCircle size={24} /></button>
                {showStampMenu && (<div className="absolute bottom-14 left-0 bg-white p-3 rounded-2xl shadow-xl border border-gray-100 grid grid-cols-2 gap-2 w-48 z-30 animate-in fade-in slide-in-from-bottom-2">{STAMPS.map((s, i) => (<button key={i} onClick={() => handleStamp(s)} className={`text-xs font-bold p-2 rounded-lg bg-gray-50 hover:${activeTheme.light} ${activeTheme.text} transition-colors`}>{s}</button>))}</div>)}
              </div>
            )}
            {playMode !== 'room_spectator' && (<button onClick={() => { if(playMode === 'local' || playMode === 'research') setGameState({...gameState, status:'finished', resignedBy:turn}); else updateDoc(getGameRef(gameId), { status:'finished', resignedBy:user.uid }); }} disabled={status !== 'playing'} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-xl font-bold active:scale-95 disabled:opacity-50">投了</button>)}
            {(playMode === 'local' || playMode === 'research') && (<button onClick={() => { const h = localHistory.slice(0, -1); setLocalHistory(h); setGameState({ ...gameState, board: h[h.length - 1], turn: turn === 'black' ? 'white' : 'black', status: 'playing', passEvent: null }); }} disabled={localHistory.length <= 1 || (status !== 'playing' && playMode !== 'research')} className={`flex-1 text-white py-3 rounded-xl font-bold active:scale-95 disabled:opacity-50 ${activeTheme.primary}`}>待った</button>)}
          </div>
        )}

        {showLeaveAlert && (<div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"><div className="bg-white p-6 rounded-2xl w-full max-w-sm text-center"><AlertTriangle size={40} className="text-red-500 mx-auto mb-3" /><h3 className="font-bold text-gray-800 text-lg mb-2">対戦を退出しますか？</h3><p className="text-sm text-gray-600 mb-6">ランク戦の途中で退出すると、<strong>敗北扱いとなりレーティングが低下</strong>します。</p><div className="flex space-x-3"><button onClick={() => setShowLeaveAlert(false)} className="flex-1 py-3 bg-gray-100 font-bold rounded-xl text-gray-600">戻る</button><button onClick={handleLeaveGame} className="flex-1 py-3 bg-red-500 font-bold rounded-xl text-white">退出する</button></div></div></div>)}

        {status === 'finished' && !isAnalysisMode && playMode !== 'history_analysis' && (
          <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-40 animate-in fade-in">
            <div className="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full text-center space-y-4">
              <h2 className="text-2xl font-black text-gray-800">{playMode === 'room_spectator' ? (win === 'draw' ? '引き分け' : (win === 'black' ? '黒の勝利！' : '白の勝利！')) : (win === 'draw' ? '引き分け' : (win === myColor ? 'あなたの勝利！' : 'あなたの負け...'))}</h2>
              {playMode === 'ranked' && lastMatchChange !== null && !resignedBy && (<div className={`text-xl font-black ${lastMatchChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>Rate: {lastMatchChange >= 0 ? `+${lastMatchChange}` : lastMatchChange}</div>)}
              <div className="flex justify-center space-x-6 text-xl font-bold py-2"><span className={win === 'black' ? activeTheme.text : 'text-gray-500'}>黒: {bC}</span><span className="text-gray-300">-</span><span className={win === 'white' ? activeTheme.text : 'text-gray-500'}>白: {wC}</span></div>
              {playMode === 'ranked' && !resignedBy && <p className="text-xs text-gray-500">戦績を更新しました</p>}
              {resignedBy && <p className="text-sm text-red-500 font-bold">相手の投了(退出)による決着</p>}
              <button onClick={handleLeaveGame} className={`w-full py-3 mt-4 text-white rounded-xl font-bold ${activeTheme.primary}`}>ホームに戻る</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderProfileGraph = (hData, key, isRev = false) => {
    let d = [...(hData || [])];
    if (d.length === 0 || d[d.length - 1].date !== todayStr) d.push({ date: todayStr, rating: profile.rating, rank: currentRank || 0 });
    const dispD = d.slice(-10);
    if (dispD.length < 2) return <div className="text-xs text-gray-400 text-center py-6 font-bold">データがありません。</div>;
    const vals = dispD.map(x => x[key]);
    let max = Math.max(...vals), min = Math.min(...vals);
    if (max - min < 20) { const m = (max + min) / 2; max = Math.ceil(m + 10); min = Math.floor(Math.max(0, m - 10)); }
    const r = Math.max(max - min, 20); const w = 300, h = 60;
    const pts = dispD.map((x, i) => { const xp = 15 + (i / (dispD.length - 1)) * 270; let yp = (x[key] - min) / r; if (isRev) yp = 1 - yp; return `${xp},${15 + (1 - yp) * 30}`; }).join(' ');

    const fmtDt = (dt) => { if (!dt) return ''; const p = dt.split('/'); return p.length >= 3 ? `${p[1]}/${p[2]}` : dt; };

    return (
      <div className="w-full overflow-hidden mt-2">
        <svg viewBox={`0 0 ${w} ${h + 20}`} className="w-full h-auto overflow-visible">
          <polyline points={pts} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {dispD.map((x, i) => {
            const xp = 15 + (i / (dispD.length - 1)) * 270; let yp = (x[key] - min) / r; if (isRev) yp = 1 - yp; const yp2 = 15 + (1 - yp) * 30;
            return ( <g key={i}><circle cx={xp} cy={yp2} r="3" fill="#10b981" /><text x={xp} y={yp2 - 6} fontSize="9" fill="#6b7280" textAnchor="middle" fontWeight="black">{x[key]}{isRev ? '位' : ''}</text><text x={xp} y={h + 16} fontSize="7" fill="#9ca3af" textAnchor="middle">{fmtDt(x.date)}</text></g> );
          })}
        </svg>
      </div>
    );
  };

  const renderProfile = () => {
    const t = profile.wins + profile.losses + profile.draws;
    const wR = t > 0 ? Math.round((profile.wins / t) * 100) : 0, lR = t > 0 ? Math.round((profile.losses / t) * 100) : 0, dR = t > 0 ? Math.round((profile.draws / t) * 100) : 0;
    const rT = profile.rating >= 1800 ? { t: 'マスター', c: 'bg-purple-100 text-purple-700 border-purple-300' } : profile.rating >= 1500 ? { t: 'ダイヤ', c: 'bg-blue-100 text-blue-700 border-blue-300' } : profile.rating >= 1300 ? { t: 'ゴールド', c: 'bg-yellow-100 text-yellow-800 border-yellow-300' } : profile.rating >= 1100 ? { t: 'シルバー', c: 'bg-gray-200 text-gray-800 border-gray-300' } : profile.rating >= 900 ? { t: 'ブロンズ', c: 'bg-orange-100 text-orange-800 border-orange-300' } : { t: 'ビギナー', c: 'bg-green-100 text-green-800 border-green-300' };

    return (
      <div className="p-4 space-y-5 min-h-full animate-in fade-in duration-300 pb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center relative overflow-hidden">
          <div className="w-20 h-20 bg-gray-100 rounded-full mx-auto mb-3 flex items-center justify-center border-2 border-gray-200 shadow-inner"><User size={36} className="text-gray-400" /></div>
          <h2 className="text-2xl font-black text-gray-800">{profile.name}</h2>
          <div className="mt-2 flex justify-center items-center space-x-2"><span className={`text-xs font-bold px-3 py-1 rounded-full border ${rT.c} flex items-center`}><Award size={14} className="mr-1" /> {rT.t}</span></div>
          <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-gray-100">
            <div className="flex flex-col items-center justify-center p-2 bg-gray-50 rounded-xl relative"><span className="text-[10px] font-bold text-gray-400 flex items-center mb-1"><Trophy size={12} className="mr-1 text-yellow-500" /> 現在</span><div className="flex flex-col items-center"><div className="flex items-baseline space-x-1"><span className={`text-xl font-black ${activeTheme.text}`}>{profile.rating}</span><span className="text-xs font-bold text-gray-500">({currentRank ? `${currentRank}位` : '-'})</span></div><div className="flex items-center space-x-3 mt-1.5 bg-white px-2.5 py-1 rounded-full shadow-sm border border-gray-100"><div className="flex items-center space-x-1"><span className="text-[9px] text-gray-400">位</span>{renderDiff('rank', dailyStats.rankDiff)}</div><div className="flex items-center space-x-1"><span className="text-[9px] text-gray-400">R</span>{renderDiff('rating', dailyStats.ratingDiff)}</div></div></div></div>
            <div className="flex flex-col items-center justify-center p-2 bg-gray-50 rounded-xl"><span className="text-[10px] font-bold text-gray-400 flex items-center mb-1"><Medal size={12} className="mr-1 text-amber-600" /> 最高</span><div className="flex items-baseline space-x-1"><span className="text-xl font-black text-gray-700">{profile.highestRating || profile.rating}</span><span className="text-xs font-bold text-gray-500">({profile.highestRank ? `${profile.highestRank}位` : '-'})</span></div></div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-2"><h3 className="font-bold text-gray-800 text-sm flex items-center"><BarChart2 size={16} className="mr-1.5 text-emerald-500" /> レーティング推移</h3>{renderProfileGraph(profile.ratingHistory, 'rating', false)}</div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-2"><h3 className="font-bold text-gray-800 text-sm flex items-center"><BarChart2 size={16} className="mr-1.5 text-emerald-500" /> 順位推移</h3>{renderProfileGraph(profile.ratingHistory, 'rank', true)}</div>
        
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1">勝率</div><div className="text-xl font-black text-gray-800">{wR}<span className="text-xs">%</span></div></div>
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1">総対局数</div><div className="text-xl font-black text-gray-800">{t}<span className="text-xs">戦</span></div></div>
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1 flex items-center justify-center"><Flame size={12} className="text-orange-500 mr-0.5" /> 連勝数</div><div className="text-xl font-black text-orange-500">{profile.currentStreak || 0}<span className="text-xs">連勝</span></div></div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <h3 className="font-bold text-gray-800 text-sm">勝敗内訳</h3>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex"><div className="bg-emerald-500 h-full" style={{ width: `${wR}%` }}></div><div className="bg-gray-300 h-full" style={{ width: `${dR}%` }}></div><div className="bg-red-500 h-full" style={{ width: `${lR}%` }}></div></div>
          <div className="flex justify-between text-xs text-gray-500 font-bold pt-1"><span className="flex items-center text-emerald-600"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1"></div>勝利: {profile.wins}</span><span className="flex items-center text-gray-500"><div className="w-2 h-2 rounded-full bg-gray-300 mr-1"></div>引分: {profile.draws}</span><span className="flex items-center text-red-500"><div className="w-2 h-2 rounded-full bg-red-500 mr-1"></div>敗北: {profile.losses}</span></div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <h3 className="font-bold text-gray-800 text-sm flex items-center"><History size={16} className="mr-1.5 text-gray-500" /> 対戦履歴 (直近)</h3>
          {(!Array.isArray(profile.history) || profile.history.length === 0) ? <div className="text-center py-6 text-gray-400 text-xs">対戦履歴がありません</div> : (
            <div className="space-y-4">
              {profile.history.map((it) => (
                <div key={it.id} className="bg-gray-50 p-3 rounded-xl">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <div className="flex items-center space-x-3"><span className={`font-black px-2 py-1 rounded text-[10px] min-w-[36px] text-center ${it.result === 'win' ? 'bg-emerald-100 text-emerald-700' : it.result === 'loss' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700'}`}>{it.result === 'win' ? '勝利' : it.result === 'loss' ? '敗北' : '引分'}</span><div><div className="font-bold text-gray-800">{it.oppName}</div><div className="text-[10px] text-gray-400">{it.date}</div></div></div>
                    <div className="text-right"><div className={`font-mono font-bold ${it.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{it.change >= 0 ? `+${it.change}` : it.change}</div><div className="text-[10px] text-gray-400 font-mono">{it.myStones} - {it.oppStones}</div></div>
                  </div>
                  {Array.isArray(it.boardHistory) && it.boardHistory.length > 0 && <button onClick={() => startHistoryAnalysis(it)} className="mt-2 px-3 py-2 w-full bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold shadow-sm border border-indigo-200 active:scale-95 flex items-center justify-center"><Bot size={14} className="mr-1"/> この対局をAI解析する</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-100 h-screen w-full flex justify-center font-sans overflow-hidden text-gray-800 select-none">
      <div className="w-full max-w-md h-full flex flex-col bg-gray-50 shadow-2xl relative">
        {incomingInvitation && currentTab !== 'play' && (
          <div className="absolute inset-x-4 top-24 bg-white p-4 rounded-2xl shadow-2xl border border-gray-100 z-50 animate-in slide-in-from-top-4">
            <div className="flex items-start"><div className="p-3 bg-emerald-100 text-emerald-600 rounded-full mr-3"><Swords size={20}/></div><div className="flex-1"><h4 className="font-bold text-gray-800 text-sm">{incomingInvitation.fromName} からの招待</h4><p className="text-xs text-gray-500 mt-1">{incomingInvitation.mode === 'ranked' ? 'ランク戦' : 'ルーム戦'}に招待されました！</p></div></div>
            <div className="flex space-x-2 mt-4"><button onClick={declineInvitation} className="flex-1 py-2 bg-gray-100 text-gray-600 font-bold rounded-xl text-sm">拒否</button><button onClick={acceptInvitation} className="flex-1 py-2 bg-emerald-500 text-white font-bold rounded-xl text-sm shadow-sm">参加する</button></div>
          </div>
        )}

        {currentTab !== 'play' && (
          <header className="bg-white pt-safe pb-4 px-6 shadow-sm z-10 flex justify-between items-center h-20">
            <h1 className="text-lg font-black tracking-tight mt-4">{currentTab === 'home' ? 'Reversi Online' : currentTab === 'friends' ? 'フレンド' : currentTab === 'profile' ? 'プロフィール' : '設定'}</h1>
          </header>
        )}

        <main className="flex-1 overflow-y-auto pb-24 relative">
          {currentTab === 'home' && renderHome()}
          {currentTab === 'play' && renderGame()}
          {currentTab === 'friends' && renderFriends()}
          {currentTab === 'profile' && renderProfile()}
          {currentTab === 'settings' && (
            <div className="p-4 space-y-6 min-h-full animate-in fade-in duration-300 pb-8">
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
                <div className="space-y-2"><label className="text-sm font-bold text-gray-700">プレイヤー名</label><input type="text" maxLength={10} value={profile.name} onChange={(e) => updateProfile({ name: e.target.value })} className={`w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-opacity-50 ${activeTheme.border}`} placeholder="名前" /></div>
                <div className="space-y-3 pt-2"><label className="text-sm font-bold text-gray-700 flex items-center"><Palette size={16} className="mr-1" /> テーマカラー</label><div className="grid grid-cols-3 gap-3">{Object.keys(THEMES).map((t) => (<button key={t} onClick={() => updateProfile({ theme: t })} className={`h-12 rounded-lg flex items-center justify-center transition-all ${THEMES[t].primary} ${profile.theme === t ? 'ring-4 ring-offset-2 ring-gray-200 scale-95' : 'opacity-80 hover:opacity-100'}`}>{profile.theme === t && <div className="w-2.5 h-2.5 bg-white rounded-full"></div>}</button>))}</div></div>
              </div>
              <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4 mt-6"><button onClick={() => setShowDeleteAlert(true)} className="w-full py-3 text-red-500 font-bold rounded-lg bg-red-50 hover:bg-red-100 transition-colors">データを削除する</button></div>
              <div className="text-center text-xs text-gray-400 mt-8">User ID: {user?.uid?.slice(0, 8)}...</div>
            </div>
          )}
        </main>

        {currentTab !== 'play' && (
          <nav className="absolute bottom-0 w-full bg-white border-t border-gray-200 pb-safe pt-2 px-6 flex justify-between items-center h-20 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
            {[ { id: 'home', icon: Home, label: 'ホーム' }, { id: 'friends', icon: Users, label: 'フレンド' }, { id: 'profile', icon: User, label: '戦績' }, { id: 'settings', icon: Settings, label: '設定' } ].map((it) => {
              const Ico = it.icon; const isA = currentTab === it.id;
              return <button key={it.id} onClick={() => setCurrentTab(it.id)} className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${isA ? activeTheme.text : 'text-gray-400'}`}><Ico size={22} className={isA ? 'mb-1 stroke-2' : 'stroke-[1.5px]'} /><span className={`text-[10px] font-bold ${isA ? 'opacity-100' : 'opacity-0 h-0'}`}>{it.label}</span></button>;
            })}
          </nav>
        )}

        {showDeleteAlert && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"><div className="bg-white p-6 rounded-2xl w-full max-w-sm text-center"><AlertTriangle size={40} className="text-red-500 mx-auto mb-3" /><h3 className="font-bold text-gray-800 text-lg mb-2">データを削除しますか？</h3><p className="text-sm text-gray-600 mb-6">すべての戦績とプロフィールが削除され、初期状態に戻ります。この操作は取り消せません。</p><div className="flex space-x-3"><button onClick={() => setShowDeleteAlert(false)} className="flex-1 py-3 bg-gray-100 font-bold rounded-xl text-gray-600">キャンセル</button><button onClick={handleDeleteData} className="flex-1 py-3 bg-red-500 font-bold rounded-xl text-white">削除する</button></div></div></div>
        )}

        {selectedFriend && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-in fade-in">
            <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-sm space-y-4 relative">
              <button onClick={() => setSelectedFriend(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20}/></button>
              <div className="text-center"><div className="w-16 h-16 bg-gray-100 rounded-full mx-auto mb-2 flex items-center justify-center border-2 border-gray-200"><User size={24} className="text-gray-400" /></div><h3 className="font-black text-xl text-gray-800">{selectedFriend.name}</h3><p className="text-sm font-bold text-gray-500 mt-1">Rate: {selectedFriend.rating}</p></div>
              {selectedFriend.profile ? (
                <div className="grid grid-cols-2 gap-2 text-center text-sm font-bold mt-4">
                  <div className="bg-gray-50 p-2 rounded-xl">最高レート<br/><span className="text-lg text-gray-800">{selectedFriend.profile.highestRating || selectedFriend.rating}</span></div>
                  <div className="bg-gray-50 p-2 rounded-xl">連勝数<br/><span className="text-lg text-orange-500">{selectedFriend.profile.currentStreak || 0}</span></div>
                  <div className="bg-gray-50 p-2 rounded-xl">勝率<br/><span className="text-lg text-emerald-600">{(selectedFriend.profile.wins + selectedFriend.profile.losses + selectedFriend.profile.draws) > 0 ? Math.round((selectedFriend.profile.wins / (selectedFriend.profile.wins + selectedFriend.profile.losses + selectedFriend.profile.draws)) * 100) : 0}%</span></div>
                  <div className="bg-gray-50 p-2 rounded-xl">総対局<br/><span className="text-lg text-gray-800">{(selectedFriend.profile.wins + selectedFriend.profile.losses + selectedFriend.profile.draws) || 0}</span></div>
                </div>
              ) : <div className="text-center py-4"><Loader2 className="animate-spin mx-auto text-emerald-500" /></div>}
              { !selectedFriend.uid.startsWith('ai_bot_') ? (
                <div className="space-y-2 mt-4 pt-4 border-t border-gray-100"><p className="text-xs text-center text-gray-400 font-bold mb-2">このフレンドを対局に招待</p><button onClick={() => handleInvite(selectedFriend.uid, 'ranked')} className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-xl flex items-center justify-center active:scale-95 mb-2"><Swords size={18} className="mr-2"/> ランク戦に招待</button><button onClick={() => handleInvite(selectedFriend.uid, 'room')} className="w-full py-3 bg-blue-50 text-blue-600 font-bold rounded-xl flex items-center justify-center active:scale-95"><Hash size={18} className="mr-2"/> ルーム戦に招待</button></div>
              ) : (
                <div className="space-y-2 mt-4 pt-4 border-t border-gray-100"><p className="text-xs text-center text-gray-400 font-bold mb-2">このAIと対局する</p><button onClick={() => handleInvite(selectedFriend.uid, 'room')} className="w-full py-3 bg-indigo-50 text-indigo-600 font-bold rounded-xl flex items-center justify-center active:scale-95"><Bot size={18} className="mr-2"/> AIとルーム戦</button></div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null, errorInfo: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) { this.setState({ errorInfo }); }
  render() {
    if (this.state.hasError) return ( <div className="p-6 bg-red-50 text-red-900 min-h-screen w-full overflow-auto text-left"><h1 className="text-xl font-bold mb-4 border-b border-red-300 pb-2">システムエラーが発生しました</h1><p className="mb-4 text-sm font-bold bg-white p-3 rounded text-red-600">{this.state.error?.toString()}</p><pre className="text-[10px] bg-white p-3 rounded border border-red-200 overflow-x-auto whitespace-pre-wrap">{this.state.errorInfo?.componentStack}</pre></div> );
    return this.props.children;
  }
}

export default function App() { return <ErrorBoundary><OthelloApp /></ErrorBoundary>; }
