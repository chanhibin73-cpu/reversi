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

// --- エラー防止のための安全な設定読み込み ---
const safeGetConfig = () => {
  const userProvidedConfig = {
    apiKey: "AIzaSyCWKHVb1tEYOGRP1Jr48fvzeX40juWUz_g",
    authDomain: "shogi-d2084.firebaseapp.com",
    databaseURL: "https://shogi-d2084-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "shogi-d2084",
    storageBucket: "shogi-d2084.firebasestorage.app",
    messagingSenderId: "454149448024",
    appId: "1:454149448024:web:223dc3d18113fe14c2c52d"
  };
  try {
    if (typeof __firebase_config !== 'undefined' && __firebase_config) return JSON.parse(__firebase_config);
    if (typeof window !== 'undefined' && window.__firebase_config) return JSON.parse(window.__firebase_config);
  } catch(e) { console.error(e); }
  return userProvidedConfig;
};

const safeGetAppId = () => {
  try {
    if (typeof __app_id !== 'undefined' && __app_id) return __app_id;
    if (typeof window !== 'undefined' && window.__app_id) return window.__app_id;
  } catch(e) { console.error(e); }
  return 'othello-app-production';
};

const safeGetInitialAuthToken = () => {
  try {
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) return __initial_auth_token;
    if (typeof window !== 'undefined' && window.__initial_auth_token) return window.__initial_auth_token;
  } catch(e) { console.error(e); }
  return null;
};

// --- Firebase Initialization ---
const firebaseConfig = safeGetConfig();
let app, auth, db;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error("Firebase init error:", error);
}

const appId = safeGetAppId();
const getGamesCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'games');
const getGameRef = (gid) => doc(db, 'artifacts', appId, 'public', 'data', 'games', gid);
const getProfileRef = (uid) => doc(db, 'artifacts', appId, 'users', uid, 'profile', 'user_profile');
const getLeaderboardRef = (uid) => doc(db, 'artifacts', appId, 'public', 'data', 'leaderboard', uid);

// --- Othello Logic ---
const INITIAL_BOARD = Array(8).fill(null).map(() => Array(8).fill(null));
INITIAL_BOARD[3][3] = 'white'; INITIAL_BOARD[3][4] = 'black';
INITIAL_BOARD[4][3] = 'black'; INITIAL_BOARD[4][4] = 'white';
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

const getFlippableStones = (board, row, col, color) => {
  if (!board || board[row][col] !== null) return [];
  const opponent = color === 'black' ? 'white' : 'black';
  let flippable = [];
  for (let [dx, dy] of DIRS) {
    let r = row + dx, c = col + dy;
    let temp = [];
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c] === opponent) { temp.push([r, c]); r += dx; c += dy; }
    if (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c] === color && temp.length > 0) flippable.push(...temp);
  }
  return flippable;
};

const getValidMoves = (board, color) => {
  if (!board) return [];
  let moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (getFlippableStones(board, r, c, color).length > 0) moves.push(`${r},${c}`);
    }
  }
  return moves;
};

const countStones = (board) => {
  let black = 0, white = 0;
  if (!board) return { black, white };
  board.forEach(row => row.forEach(cell => { if (cell === 'black') black++; if (cell === 'white') white++; }));
  return { black, white };
};

const calcRatingChange = (myRate, oppRate, myStones, oppStones, isWin, isDraw) => {
  const K = 48;
  const expected = 1 / (1 + Math.pow(10, (oppRate - myRate) / 400));
  const actual = isDraw ? 0.5 : (isWin ? 1 : 0);
  const baseDiff = K * (actual - expected);
  const stoneDiff = myStones - oppStones;
  const bonus = isDraw ? 0 : stoneDiff * 0.5; 
  let change = Math.round(baseDiff + bonus);
  if (isWin && change < 1) change = 1;
  if (!isWin && !isDraw && change > -1) change = -1;
  return change;
};

// --- AI (Minimax) Logic ---
const getAiDepth = (rating, totalGames) => {
  let depth = 3 + Math.floor((rating - 1000) / 200) + Math.floor(totalGames / 100);
  return Math.max(1, Math.min(depth, 5));
};

const getSimulatedMoves = (board, color) => {
  let moves = [];
  for (let r=0; r<8; r++) {
    for (let c=0; c<8; c++) {
      const flips = getFlippableStones(board, r, c, color);
      if (flips.length > 0) moves.push({ r, c, flips });
    }
  }
  return moves;
};

const evaluateBoard = (board, color) => {
  const opp = color === 'black' ? 'white' : 'black';
  let score = 0;
  const w = [
    [120,-20, 20,  5,  5, 20,-20,120],
    [-20,-40, -5, -5, -5, -5,-40,-20],
    [ 20, -5, 15,  3,  3, 15, -5, 20],
    [  5, -5,  3,  3,  3,  3, -5,  5],
    [  5, -5,  3,  3,  3,  3, -5,  5],
    [ 20, -5, 15,  3,  3, 15, -5, 20],
    [-20,-40, -5, -5, -5, -5,-40,-20],
    [120,-20, 20,  5,  5, 20,-20,120]
  ];
  for (let r=0; r<8; r++) {
    for (let c=0; c<8; c++) {
      if (board[r][c] === color) score += w[r][c];
      else if (board[r][c] === opp) score -= w[r][c];
    }
  }
  return score;
};

const minimax = (board, depth, alpha, beta, isMaximizing, color, origColor) => {
  if (depth === 0) return evaluateBoard(board, origColor);
  const moves = getSimulatedMoves(board, color);
  if (moves.length === 0) {
    const opp = color === 'black' ? 'white' : 'black';
    if (getSimulatedMoves(board, opp).length === 0) {
      const {black, white} = countStones(board);
      const myCount = origColor === 'black' ? black : white;
      const oppCount = origColor === 'black' ? white : black;
      return myCount > oppCount ? 10000 : (myCount < oppCount ? -10000 : 0);
    }
    return minimax(board, depth - 1, alpha, beta, !isMaximizing, opp, origColor);
  }

  let bestEval = isMaximizing ? -Infinity : Infinity;
  for (let move of moves) {
    let newBoard = board.map(r => [...r]);
    newBoard[move.r][move.c] = color;
    move.flips.forEach(([fr, fc]) => newBoard[fr][fc] = color);
    let ev = minimax(newBoard, depth - 1, alpha, beta, !isMaximizing, color === 'black' ? 'white' : 'black', origColor);
    
    if (isMaximizing) {
      bestEval = Math.max(bestEval, ev);
      alpha = Math.max(alpha, ev);
    } else {
      bestEval = Math.min(bestEval, ev);
      beta = Math.min(beta, ev);
    }
    if (beta <= alpha) break;
  }
  return bestEval;
};

const getBestMove = (board, color, depth) => {
  const moves = getSimulatedMoves(board, color);
  if (moves.length === 0) return null;
  if (moves.length === 1) return `${moves[0].r},${moves[0].c}`;

  let bestScore = -Infinity;
  let bestMove = null;
  moves.sort(() => Math.random() - 0.5);

  for (let move of moves) {
    let newBoard = board.map(r => [...r]);
    newBoard[move.r][move.c] = color;
    move.flips.forEach(([fr, fc]) => newBoard[fr][fc] = color);
    let score = minimax(newBoard, depth - 1, -Infinity, Infinity, false, color === 'black' ? 'white' : 'black', color);
    if (score > bestScore) { bestScore = score; bestMove = move; }
  }
  return `${bestMove.r},${bestMove.c}`;
};

// --- Configs & Data ---
const THEMES = {
  green: { primary: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-600', light: 'bg-emerald-50', board: 'bg-emerald-800', grid: 'bg-emerald-900', cell: 'bg-emerald-600' },
  blue: { primary: 'bg-blue-600', text: 'text-blue-600', border: 'border-blue-600', light: 'bg-blue-50', board: 'bg-blue-800', grid: 'bg-blue-900', cell: 'bg-blue-600' },
  dark: { primary: 'bg-gray-800', text: 'text-gray-800', border: 'border-gray-800', light: 'bg-gray-200', board: 'bg-gray-700', grid: 'bg-gray-900', cell: 'bg-gray-600' },
};
const STAMPS = ['よろしく！', '考え中…', 'ナイス！', 'あちゃー', '参りました', 'ありがとう！'];

// ==========================================
// メインのオセロアプリ コンポーネント
// ==========================================
function OthelloApp() {
  const todayStr = new Date().toLocaleDateString('ja-JP');

  const [user, setUser] = useState(null);
  const [isFirstLogin, setIsFirstLogin] = useState(false); 
  const [initName, setInitName] = useState(''); 
  const [initError, setInitError] = useState(null); 

  const [profile, setProfile] = useState({ 
    name: '', rating: 1000, highestRating: 1000, highestRank: null, 
    wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], friends: [], theme: 'green' 
  });
  const [currentTab, setCurrentTab] = useState('home'); 
  const [playMode, setPlayMode] = useState(null); 
  
  const [gameId, setGameId] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [localHistory, setLocalHistory] = useState([]); 
  
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
  
  const [showDeleteAlert, setShowDeleteAlert] = useState(false); // データ削除用モーダル

  const activeTheme = THEMES[profile.theme] || THEMES.green;

  // --- User Online Status Management ---
  const updateUserStatus = async (status) => {
    if (!user || isFirstLogin) return;
    try { await updateDoc(getLeaderboardRef(user.uid), { status }); } catch (e) {}
  };

  useEffect(() => {
    if (!user || isFirstLogin) return;
    const handleVisibilityChange = () => updateUserStatus(document.visibilityState === 'hidden' ? 'offline' : (playMode ? 'playing' : 'online'));
    const handleBeforeUnload = () => updateUserStatus('offline');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    updateUserStatus(playMode ? 'playing' : 'online');
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, isFirstLogin, playMode]);

  // --- Init & Auth ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = safeGetInitialAuthToken();
        if (token) await signInWithCustomToken(auth, token);
        else await signInAnonymously(auth);
      } catch (e) { console.error(e); }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // AI 初期化
        try {
          const aiCheck = await getDoc(getLeaderboardRef('ai_bot_31'));
          if (!aiCheck.exists()) {
            for (let i = 0; i < 32; i++) {
              const uid = `ai_bot_${i}`;
              const aiName = `AI-Player-${i+1}`;
              
              // 既に存在している場合は上書きしないようにする
              const lbSnap = await getDoc(getLeaderboardRef(uid));
              if (!lbSnap.exists()) {
                await setDoc(getLeaderboardRef(uid), { uid, name: aiName, rating: 1000, dailyDate: todayStr, dailyRating: 1000, dailyRank: 0, isAI: true, status: 'online' }).catch(()=>{});
                await setDoc(getProfileRef(uid), { name: aiName, rating: 1000, highestRating: 1000, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], theme: 'dark', isAI: true }).catch(()=>{});
              }
            }
          }
        } catch(e) { console.error("AI Setup Exception:", e); }

        try {
          const pSnap = await getDoc(getProfileRef(currentUser.uid));
          if (pSnap.exists()) {
            setProfile({ ...pSnap.data(), friends: pSnap.data().friends || [] });
            setIsFirstLogin(false);
          } else {
            setIsFirstLogin(true);
          }
        } catch(e) {
          console.error("Profile load error", e);
          setIsFirstLogin(true);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleInitialRegistration = async () => {
    if (!user || initName.trim() === '') return;
    setInitError(null);
    const newProfile = { name: initName.trim(), rating: 1000, highestRating: 1000, highestRank: null, wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], friends: [], theme: 'green' };
    
    try {
      await setDoc(getProfileRef(user.uid), newProfile);
      await setDoc(getLeaderboardRef(user.uid), { uid: user.uid, name: newProfile.name, rating: newProfile.rating, dailyDate: todayStr, dailyRating: newProfile.rating, dailyRank: 0, status: 'online' });
      setProfile(newProfile);
      setIsFirstLogin(false);
    } catch (e) { 
      console.error("Registration Error:", e);
      setInitError("登録に失敗しました。通信環境をご確認ください。");
    }
  };

  const updateProfile = async (updates) => {
    const newProfile = { ...profile, ...updates };
    setProfile(newProfile);
    if (user) {
      await updateDoc(getProfileRef(user.uid), updates).catch(e => console.error(e));
      if (updates.rating !== undefined || updates.name !== undefined) {
        await setDoc(getLeaderboardRef(user.uid), { uid: user.uid, name: newProfile.name, rating: newProfile.rating }, { merge: true }).catch(e => console.error(e));
      }
    }
  };

  const toggleFriend = async (targetUid) => {
    const newFriends = profile.friends?.includes(targetUid)
      ? profile.friends.filter(id => id !== targetUid)
      : [...(profile.friends || []), targetUid];
    await updateProfile({ friends: newFriends });
  };

  const handleDeleteData = async () => {
    try {
      if (user) {
        await deleteDoc(getProfileRef(user.uid));
        await deleteDoc(getLeaderboardRef(user.uid));
      }
      setProfile({ 
        name: '', rating: 1000, highestRating: 1000, highestRank: null, 
        wins: 0, losses: 0, draws: 0, currentStreak: 0, history: [], friends: [], theme: 'green' 
      });
      setInitName('');
      setCurrentTab('home');
      setShowDeleteAlert(false);
      setIsFirstLogin(true);
    } catch (e) {
      console.error("Data deletion error:", e);
      setShowDeleteAlert(false);
    }
  };

  // --- Leaderboard & AI Match Simulation ---
  useEffect(() => {
    if (!user || isFirstLogin) return; 
    const unsubscribe = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard'), (snap) => {
      let data = [];
      snap.forEach(doc => data.push(doc.data()));
      data.sort((a, b) => b.rating - a.rating);
      setLeaderboardData(data);
      
      const myIndex = data.findIndex(d => d.uid === user.uid);
      if (myIndex !== -1) {
        const myRank = myIndex + 1;
        setCurrentRank(myRank);
        const myLbData = data[myIndex];
        
        setProfile(prev => {
          if (!prev.highestRank || myRank < prev.highestRank) {
            updateDoc(getProfileRef(user.uid), { highestRank: myRank }).catch(()=>{});
            return { ...prev, highestRank: myRank };
          }
          return prev;
        });

        if (myLbData.dailyDate !== todayStr) {
          setDoc(getLeaderboardRef(user.uid), { dailyDate: todayStr, dailyRating: myLbData.rating, dailyRank: myRank }, { merge: true }).catch(()=>{});
          setDailyStats({ rankDiff: 0, ratingDiff: 0 });
        } else {
          setDailyStats({ rankDiff: myLbData.dailyRank ? myLbData.dailyRank - myRank : 0, ratingDiff: myLbData.dailyRating ? myLbData.rating - myLbData.dailyRating : 0 });
        }
      }

      data.forEach((u, idx) => {
        if (u.uid !== user?.uid && (u.dailyDate !== todayStr || !u.dailyRank)) {
          const rank = idx + 1;
          setTimeout(() => {
            updateDoc(getLeaderboardRef(u.uid), { dailyDate: todayStr, dailyRating: u.rating, dailyRank: rank }, { merge: true }).catch(()=>{});
          }, Math.random() * 8000 + 2000);
        }
      });
    });

    const interval = setInterval(async () => {
      try {
        if (Math.random() < 0.60) { 
          const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard'));
          let aiList = [];
          snap.forEach(d => { if(d.data().uid?.startsWith('ai_bot_')) aiList.push(d.data()); });
          if (aiList.length >= 2) {
            const a1 = aiList[Math.floor(Math.random() * aiList.length)];
            let a2 = aiList[Math.floor(Math.random() * aiList.length)];
            let retryCount = 0;
            while(a1.uid === a2.uid && retryCount < 10) { 
              a2 = aiList[Math.floor(Math.random() * aiList.length)]; 
              retryCount++; 
            }
            if(a1.uid === a2.uid) return;
            
            await updateDoc(getLeaderboardRef(a1.uid), { status: 'playing' }).catch(()=>{});
            await updateDoc(getLeaderboardRef(a2.uid), { status: 'playing' }).catch(()=>{});

            setTimeout(async () => {
              const expected = 1 / (1 + Math.pow(10, (a2.rating - a1.rating) / 400));
              const isA1Win = Math.random() < expected;
              const isDraw = Math.random() < 0.05;
              const myStones = isDraw ? 32 : (isA1Win ? 34 + Math.floor(Math.random()*15) : 30 - Math.floor(Math.random()*15));
              const oppStones = 64 - myStones;

              const a1Change = calcRatingChange(a1.rating, a2.rating, myStones, oppStones, isA1Win && !isDraw, isDraw);
              const a2Change = calcRatingChange(a2.rating, a1.rating, oppStones, myStones, !isA1Win && !isDraw, isDraw);
              
              const updates = [
                {uid:a1.uid, change:a1Change, isWin:isA1Win&&!isDraw, isDraw}, 
                {uid:a2.uid, change:a2Change, isWin:!isA1Win&&!isDraw, isDraw}
              ];

              for (let target of updates) {
                 const currentLb = target.uid === a1.uid ? a1 : a2;
                 const newRating = Math.max(0, (currentLb.rating || 1000) + target.change);
                 await updateDoc(getLeaderboardRef(target.uid), { rating: newRating, status: 'online' }).catch(()=>{});
                 
                 try {
                   const pSnap = await getDoc(getProfileRef(target.uid));
                   if (pSnap.exists()) {
                     const p = pSnap.data();
                     await updateDoc(getProfileRef(target.uid), {
                       rating: newRating, highestRating: Math.max(p.highestRating || 1000, newRating),
                       wins: (p.wins || 0) + (target.isWin ? 1 : 0), 
                       losses: (p.losses || 0) + (!target.isWin && !target.isDraw ? 1 : 0), 
                       draws: (p.draws || 0) + (target.isDraw ? 1 : 0)
                     });
                   }
                 } catch(e) {} 
              }
            }, 5000); 
          }
        }
      } catch(e) {}
    }, 20000);

    return () => { unsubscribe(); clearInterval(interval); };
  }, [user, isFirstLogin, todayStr]);

  // --- Game Sync ---
  useEffect(() => {
    if (!user || !gameId || playMode === 'local') return;
    const unsubscribe = onSnapshot(getGameRef(gameId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (typeof data.board === 'string') data.board = JSON.parse(data.board);
        setGameState(data);
      }
    });
    return () => unsubscribe();
  }, [user, gameId, playMode]);

  useEffect(() => {
    if (gameState?.stamp && Date.now() - gameState.stamp.time < 5000) {
      setActiveStamp(gameState.stamp);
      const timer = setTimeout(() => setActiveStamp(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [gameState?.stamp]);

  useEffect(() => {
    if (gameState?.passEvent && Date.now() - gameState.passEvent.time < 4000) {
      const colorName = gameState.passEvent.color === 'black' ? '黒' : '白';
      setToastMessage(`${colorName}は置ける場所がないためパスしました！`);
      const timer = setTimeout(() => setToastMessage(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [gameState?.passEvent]);

  // --- AI Turn Execution ---
  useEffect(() => {
    if (!gameState || gameState.status !== 'playing' || playMode !== 'ranked') return;
    const aiId = gameState.turn === 'black' ? gameState.player1 : gameState.player2;

    if (aiId?.startsWith('ai_bot_') && (gameState.player1 === user?.uid || gameState.player2 === user?.uid)) {
      const aiData = gameState.turn === 'black' ? gameState.player1Data : gameState.player2Data;
      const totalGames = (aiData.wins||0) + (aiData.losses||0) + (aiData.draws||0);
      const depth = getAiDepth(aiData.rating || 1000, totalGames);

      const timer = setTimeout(() => {
        const moveStr = getBestMove(gameState.board, gameState.turn, depth);
        if (moveStr) {
          const [r, c] = moveStr.split(',').map(Number);
          handleMove(r, c, gameState.turn);
        } else {
           if (getValidMoves(gameState.board, gameState.turn).length === 0) {
              const nextTurn = gameState.turn === 'black' ? 'white' : 'black';
              let nextStatus = 'playing';
              if (getValidMoves(gameState.board, nextTurn).length === 0) nextStatus = 'finished';
              updateDoc(getGameRef(gameId), { turn: nextTurn, status: nextStatus, passEvent: { color: gameState.turn, time: Date.now() } });
           }
        }
      }, 1500 + Math.random() * 1000);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.board, gameState?.turn, gameState?.status, user, playMode, gameId]);

  // --- Game Result Processing ---
  useEffect(() => {
    if (!user || !gameState || gameState.status !== 'finished' || playMode !== 'ranked') return;
    if (gameState.resultProcessedBy?.includes(user.uid)) return; 
    
    const isP1 = gameState.player1 === user.uid;
    const isP2 = gameState.player2 === user.uid;
    if (!isP1 && !isP2) return;

    const processResult = async () => {
      try {
        const myColor = isP1 ? 'black' : 'white';
        const { black, white } = countStones(gameState.board);
        const myStones = myColor === 'black' ? black : white;
        const oppStones = myColor === 'black' ? white : black;
        
        let isWin = false, isDraw = false;
        if (gameState.resignedBy) isWin = gameState.resignedBy !== user.uid;
        else {
          if (myStones > oppStones) isWin = true;
          else if (myStones === oppStones) isDraw = true;
        }

        const oppData = isP1 ? gameState.player2Data : gameState.player1Data;
        const change = calcRatingChange(profile.rating, oppData?.rating || 1000, myStones, oppStones, isWin, isDraw);
        const newRating = Math.max(0, profile.rating + change);
        const historyItem = { id: Date.now(), oppName: oppData?.name || '対戦相手', result: isDraw ? 'draw' : (isWin ? 'win' : 'loss'), change, myStones, oppStones, date: new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) };

        await updateProfile({
          rating: newRating, highestRating: Math.max(profile.highestRating || 1000, newRating), currentStreak: isWin && !isDraw ? (profile.currentStreak || 0) + 1 : 0,
          wins: profile.wins + (isWin && !isDraw ? 1 : 0), losses: profile.losses + (!isWin && !isDraw ? 1 : 0), draws: profile.draws + (isDraw ? 1 : 0), history: [historyItem, ...(profile.history || [])].slice(0, 10)
        });

        const oppUid = isP1 ? gameState.player2 : gameState.player1;
        if (oppUid?.startsWith('ai_bot_')) {
           try {
             const aiLbSnap = await getDoc(getLeaderboardRef(oppUid));
             let currentAiRating = 1000;
             if (aiLbSnap.exists()) currentAiRating = aiLbSnap.data().rating;
             
             const aiChange = calcRatingChange(currentAiRating, profile.rating, oppStones, myStones, !isWin && !isDraw, isDraw);
             const newAiRating = Math.max(0, currentAiRating + aiChange);
             
             await updateDoc(getLeaderboardRef(oppUid), { rating: newAiRating }).catch(()=>{});
             
             const aiSnap = await getDoc(getProfileRef(oppUid));
             if(aiSnap.exists()) {
               const aiP = aiSnap.data();
               await updateDoc(getProfileRef(oppUid), {
                 rating: newAiRating, highestRating: Math.max(aiP.highestRating || 1000, newAiRating),
                 wins: (aiP.wins || 0) + (!isWin && !isDraw ? 1 : 0), losses: (aiP.losses || 0) + (isWin && !isDraw ? 1 : 0), draws: (aiP.draws || 0) + (isDraw ? 1 : 0)
               });
             }
           } catch(e) { console.warn("AI Update Rules Error", e); }
        }

        await updateDoc(getGameRef(gameId), { resultProcessedBy: arrayUnion(user.uid) });
      } catch (err) {
        console.error("Result Process Error:", err);
      }
    };
    processResult();
  }, [gameState?.status]);


  // --- Helper Renderers ---
  const getRankStyle = (rate) => {
    if (rate >= 1800) return 'text-purple-600 bg-purple-100';
    if (rate >= 1500) return 'text-blue-600 bg-blue-100';
    if (rate >= 1300) return 'text-yellow-600 bg-yellow-100';
    if (rate >= 1100) return 'text-gray-600 bg-gray-200';
    if (rate >= 900) return 'text-orange-600 bg-orange-100';
    return 'text-green-600 bg-green-100';
  };

  const renderDiff = (type, diff) => {
    if (diff === 0 || !diff) return <span className="text-gray-400 font-bold text-[11px] flex items-center justify-center">±0</span>;
    if (type === 'rank') {
      if (diff > 0) return <span className="text-emerald-500 font-black text-[11px] flex items-center justify-center">↑{diff}</span>;
      return <span className="text-red-500 font-black text-[11px] flex items-center justify-center">↓{Math.abs(diff)}</span>;
    } else {
      if (diff > 0) return <span className="text-emerald-500 font-black text-[11px] flex items-center justify-center">+{diff}</span>;
      return <span className="text-red-500 font-black text-[11px] flex items-center justify-center">{diff}</span>;
    }
  };

  const getStatusColor = (status) => {
    if (status === 'playing') return 'bg-yellow-400';
    if (status === 'online') return 'bg-emerald-500';
    return 'bg-red-500'; 
  };

  const startAiMatchImmediately = async (gid) => {
    if (matchTimeoutId) clearTimeout(matchTimeoutId);
    const aiIndex = Math.floor(Math.random() * 32);
    const aiId = `ai_bot_${aiIndex}`;
    
    let aiData = { name: `AI-Player-${aiIndex+1}`, rating: 1000, wins: 0, losses: 0, draws: 0 };
    try {
      const aiLbSnap = await getDoc(getLeaderboardRef(aiId));
      if (aiLbSnap.exists()) aiData.rating = aiLbSnap.data().rating;
      
      const aiProfileSnap = await getDoc(getProfileRef(aiId));
      if (aiProfileSnap.exists()) aiData = aiProfileSnap.data();
    } catch(e) {}

    try {
      await updateDoc(getGameRef(gid), { 
        status: 'playing', 
        player2: aiId, 
        player2Data: { name: aiData.name, rating: aiData.rating, wins: aiData.wins||0, losses: aiData.losses||0, draws: aiData.draws||0 } 
      });
    } catch (e) { console.error(e); }
  };

  // --- Matchmaking ---
  const startRankedMatch = async () => {
    if (!user) return;
    if (matchTimeoutId) clearTimeout(matchTimeoutId);
    setPlayMode('matching'); setCurrentTab('play');
    try {
      const snap = await getDocs(getGamesCollection());
      let foundGame = null;
      snap.forEach(doc => {
        const data = doc.data();
        if (data.status === 'waiting' && data.gameType === 'ranked' && data.player1 !== user.uid) foundGame = { id: doc.id, ...data };
      });
      if (foundGame) {
        await updateDoc(getGameRef(foundGame.id), { status: 'playing', player2: user.uid, player2Data: { name: profile.name, rating: profile.rating } });
        setGameId(foundGame.id); setPlayMode('ranked');
      } else {
        const initB = INITIAL_BOARD.map(r => [...r]);
        const newGameRef = await addDoc(getGamesCollection(), {
          gameType: 'ranked', status: 'waiting', board: JSON.stringify(initB), turn: 'black',
          player1: user.uid, player1Data: { name: profile.name, rating: profile.rating }, player2: null, player2Data: null, resultProcessedBy: []
        });
        setGameId(newGameRef.id); setPlayMode('ranked');
        
        const tid = setTimeout(async () => {
          try {
            const checkSnap = await getDoc(getGameRef(newGameRef.id));
            if(checkSnap.exists() && checkSnap.data().status === 'waiting') {
               await startAiMatchImmediately(newGameRef.id);
            }
          } catch(e) {}
        }, 30000);
        setMatchTimeoutId(tid);
      }
    } catch (e) { setPlayMode(null); setCurrentTab('home'); }
  };

  const joinRoom = async (roomPin) => {
    if (!user || roomPin.length !== 4) return;
    setShowRoomModal(false); setPlayMode('matching'); setCurrentTab('play');
    const roomRef = getGameRef(roomPin);
    try {
      let role = '';
      await runTransaction(db, async (transaction) => {
        const roomDoc = await transaction.get(roomRef);
        if (!roomDoc.exists()) {
          const initB = INITIAL_BOARD.map(r => [...r]);
          transaction.set(roomRef, { gameType: 'room', status: 'waiting', board: JSON.stringify(initB), turn: 'black', player1: user.uid, player1Data: { name: profile.name }, player2: null, player2Data: null });
          role = 'player';
        } else {
          const data = roomDoc.data();
          if (data.status === 'waiting' && !data.player2 && data.player1 !== user.uid) {
             transaction.update(roomRef, { status: 'playing', player2: user.uid, player2Data: { name: profile.name } }); role = 'player';
          } else if (data.player1 === user.uid || data.player2 === user.uid) role = 'player';
          else role = 'spectator';
        }
      });
      setGameId(roomPin); setPlayMode(role === 'player' ? 'room' : 'room_spectator');
    } catch (e) {
      setPlayMode(null); setCurrentTab('home');
      setTimeout(() => alert('同時アクセスなどにより入室できませんでした。'), 100);
    }
  };

  const startLocalMatch = () => {
    const initB = INITIAL_BOARD.map(r => [...r]);
    setGameState({ status: 'playing', board: initB, turn: 'black', player1Data: { name: 'Player 1' }, player2Data: { name: 'Player 2' } });
    setLocalHistory([initB]); setPlayMode('local'); setCurrentTab('play');
  };

  // --- Game Actions ---
  const handleMove = async (row, col, forceColor = null) => {
    if (!gameState || gameState.status !== 'playing' || playMode === 'room_spectator') return;
    
    let myColor = forceColor;
    if (!myColor) {
      myColor = playMode === 'local' ? gameState.turn : (gameState.player1 === user.uid ? 'black' : 'white');
      if (gameState.turn !== myColor) return;
    }

    const flippable = getFlippableStones(gameState.board, row, col, myColor);
    if (flippable.length === 0) return;

    let newBoard = gameState.board.map(r => [...r]);
    newBoard[row][col] = myColor;
    flippable.forEach(([r, c]) => { newBoard[r][c] = myColor; });

    let nextTurn = myColor === 'black' ? 'white' : 'black';
    let nextStatus = 'playing';
    let passEvent = null;

    if (getValidMoves(newBoard, nextTurn).length === 0) {
      passEvent = { color: nextTurn, time: Date.now() };
      nextTurn = myColor;
      if (getValidMoves(newBoard, nextTurn).length === 0) nextStatus = 'finished';
    }

    if (playMode === 'local') {
      setLocalHistory([...localHistory, newBoard]);
      setGameState({ ...gameState, board: newBoard, turn: nextTurn, status: nextStatus, passEvent });
    } else {
      setGameState({ ...gameState, board: newBoard, turn: nextTurn, status: nextStatus, passEvent }); 
      await updateDoc(getGameRef(gameId), { board: JSON.stringify(newBoard), turn: nextTurn, status: nextStatus, passEvent });
    }
  };

  const handleStamp = async (text) => {
    if (!gameId || playMode === 'local' || playMode === 'room_spectator') return;
    await updateDoc(getGameRef(gameId), { stamp: { sender: user.uid, text, time: Date.now() } });
    setShowStampMenu(false);
  };

  const handleLeaveGame = async () => {
    if (matchTimeoutId) clearTimeout(matchTimeoutId);
    
    if (playMode === 'ranked' && gameState?.status === 'playing') {
      try { 
        const myColor = gameState.player1 === user.uid ? 'black' : 'white';
        const oppData = myColor === 'black' ? gameState.player2Data : gameState.player1Data;
        const change = calcRatingChange(profile.rating, oppData?.rating || 1000, 0, 64, false, false);
        const newRating = Math.max(0, profile.rating + change);
        const historyItem = { id: Date.now(), oppName: oppData?.name || '対戦相手', result: 'loss', change, myStones: 0, oppStones: 64, date: new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) };

        await updateProfile({
          rating: newRating, currentStreak: 0, losses: profile.losses + 1, history: [historyItem, ...(profile.history || [])].slice(0, 10)
        });

        await updateDoc(getGameRef(gameId), { status: 'finished', resignedBy: user.uid, resultProcessedBy: arrayUnion(user.uid) }); 
      } catch (e) {}
    }

    setPlayMode(null); setGameId(null); setGameState(null); setCurrentTab('home'); setShowLeaveAlert(false);
  };

  // --- Initial Registration Screen ---
  if (isFirstLogin) {
    return (
      <div className="bg-gray-100 h-screen w-full flex justify-center font-sans overflow-hidden text-gray-800">
        <div className="w-full max-w-md h-full flex flex-col bg-gray-50 shadow-2xl relative items-center justify-center p-6 space-y-8 animate-in fade-in duration-500">
          <div className="text-center space-y-4">
             <div className="w-24 h-24 bg-emerald-600 rounded-3xl mx-auto shadow-lg flex items-center justify-center transform rotate-3"><Swords size={48} className="text-white" /></div>
             <h1 className="text-3xl font-black text-gray-800 tracking-tight">REVERSI</h1>
             <p className="text-sm text-gray-500 font-bold">オンライン対戦へようこそ！</p>
          </div>
          <div className="w-full bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
             <div className="space-y-2">
               <label className="text-sm font-bold text-gray-700 ml-1">プレイヤー名を入力</label>
               <input type="text" maxLength={10} value={initName} onChange={(e) => setInitName(e.target.value)} className="w-full p-4 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-lg font-bold text-center" placeholder="名前 (10文字以内)" autoFocus />
             </div>
             {initError && (
               <div className="text-xs text-red-500 font-bold bg-red-50 p-3 rounded-lg border border-red-200">
                 {initError}
               </div>
             )}
             <button onClick={handleInitialRegistration} disabled={initName.trim() === ''} className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black text-lg shadow-sm disabled:opacity-50 disabled:bg-gray-400 active:scale-95 transition-all flex items-center justify-center">はじめる <ChevronRightCircle size={20} className="ml-2" /></button>
          </div>
          <p className="text-xs text-gray-400 text-center">名前は後から設定画面で変更できます。</p>
        </div>
      </div>
    );
  }

  // --- Renderers ---
  const renderHome = () => (
    <div className="p-4 space-y-5 flex flex-col min-h-full animate-in fade-in duration-300">
      <div className={`p-6 rounded-2xl text-white shadow-lg flex flex-col items-center justify-center space-y-2 ${activeTheme.primary}`}>
        <h2 className="text-3xl font-black tracking-wider">REVERSI</h2>
      </div>
      <div className="space-y-3 flex-1">
        <button onClick={startRankedMatch} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform">
          <div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><Swords size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ランク戦</h3><p className="text-xs text-gray-500">レートを懸けた真剣勝負</p></div></div><ChevronRight size={20} className="text-gray-400" />
        </button>
        <button onClick={() => setShowRoomModal(true)} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform">
          <div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><Hash size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ルーム戦</h3><p className="text-xs text-gray-500">PINコードで友達と対戦・観戦</p></div></div><ChevronRight size={20} className="text-gray-400" />
        </button>
        <button onClick={startLocalMatch} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform">
          <div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><Users size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ローカル対戦</h3><p className="text-xs text-gray-500">1台の端末で2人プレイ</p></div></div><ChevronRight size={20} className="text-gray-400" />
        </button>
        <button onClick={() => setShowLeaderboard(true)} className="w-full bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between active:scale-95 transition-transform">
          <div className="flex items-center space-x-4"><div className={`p-3 rounded-full ${activeTheme.light} ${activeTheme.text}`}><BarChart2 size={24} /></div><div className="text-left"><h3 className="font-bold text-gray-800">ランキング</h3><p className="text-xs text-gray-500">トッププレイヤーと順位変動</p></div></div><ChevronRight size={20} className="text-gray-400" />
        </button>
      </div>

      {showRoomModal && (
        <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-xs space-y-4">
            <h3 className="font-bold text-center text-gray-800">ルームナンバー入力</h3>
            <p className="text-xs text-center text-gray-500">4桁の数字を入力して入室します。<br/>3人目以降は観戦になります。</p>
            <input type="text" inputMode="numeric" pattern="\d*" maxLength={4} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0000" className="w-full text-center text-3xl tracking-[0.5em] font-mono p-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <div className="flex space-x-3 pt-2">
              <button onClick={() => setShowRoomModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold">キャンセル</button>
              <button onClick={() => joinRoom(roomNumber)} disabled={roomNumber.length !== 4} className={`flex-1 py-3 text-white rounded-xl font-bold disabled:opacity-50 ${activeTheme.primary}`}>入室</button>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50 animate-in fade-in">
          <div className="bg-white w-full h-[85%] rounded-t-3xl shadow-xl flex flex-col animate-in slide-in-from-bottom-full duration-300">
            <div className="p-4 flex justify-between items-center border-b border-gray-100">
              <h2 className="text-xl font-black flex items-center"><Trophy className="text-yellow-500 mr-2"/> ランキング</h2>
              <button onClick={() => setShowLeaderboard(false)} className="p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {leaderboardData.slice(0, 30).map((lbUser, idx) => {
                const isToday = lbUser.dailyDate === todayStr;
                const lbRank = idx + 1;
                const rankDiff = isToday && lbUser.dailyRank ? lbUser.dailyRank - lbRank : 0;
                const ratingDiff = isToday && (lbUser.dailyRating !== undefined) ? lbUser.rating - lbUser.dailyRating : 0;

                return (
                  <div key={lbUser.uid} className={`flex items-center justify-between p-4 rounded-xl border ${lbUser.uid === user?.uid ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-200' : 'bg-white border-gray-100 shadow-sm'}`}>
                    <div className="flex items-center space-x-3 flex-1">
                      <div className="flex flex-col items-center justify-center w-8">
                        <span className={`font-black text-lg leading-none mb-0.5 ${idx===0 ? 'text-yellow-500' : idx===1 ? 'text-gray-400' : idx===2 ? 'text-amber-600' : 'text-gray-300'}`}>{lbRank}</span>
                        {renderDiff('rank', rankDiff)}
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(lbUser.status)} shadow-sm`}></div>
                        <div className="font-bold text-gray-800 truncate pr-2 max-w-[100px]">{lbUser.name}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className={`font-black px-3 py-1 rounded-full text-sm ${getRankStyle(lbUser.rating)}`}>{lbUser.rating}</div>
                      <div className="mt-1">{renderDiff('rating', ratingDiff)}</div>
                    </div>
                    {lbUser.uid !== user?.uid && (
                      <button onClick={() => toggleFriend(lbUser.uid)} className="ml-2 p-1.5 rounded-full hover:bg-gray-100 transition-colors">
                        {profile.friends?.includes(lbUser.uid) ? <UserMinus size={18} className="text-gray-400" /> : <UserPlus size={18} className={activeTheme.text} />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center rounded-b-3xl">
              <div className="flex flex-col"><span className="text-xs font-bold text-gray-500 mb-1">あなたの現在順位</span><span className="font-bold text-gray-800">{profile.name}</span></div>
              <div className="flex flex-col items-end">
                <div className="flex items-baseline space-x-2"><span className={`font-black text-2xl ${activeTheme.text}`}>{currentRank ? `${currentRank}位` : '-'}</span><div className="w-8 flex justify-center">{renderDiff('rank', dailyStats.rankDiff)}</div></div>
                <div className="flex items-center space-x-2"><span className="text-xs font-bold text-gray-400">Rate: {profile.rating}</span><div className="w-8 flex justify-center">{renderDiff('rating', dailyStats.ratingDiff)}</div></div>
              </div>
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
              <div key={fUser.uid} className="flex items-center justify-between p-4 rounded-xl bg-white border border-gray-100 shadow-sm">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(fUser.status)} shadow-sm border border-white`}></div>
                  <div className="font-bold text-gray-800">{fUser.name}</div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`font-black px-3 py-1 rounded-full text-xs ${getRankStyle(fUser.rating)}`}>Rate: {fUser.rating}</span>
                  <button onClick={() => toggleFriend(fUser.uid)} className="p-2 bg-gray-50 rounded-full text-gray-400 hover:text-red-500 transition-colors"><UserMinus size={16} /></button>
                </div>
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
        <Loader2 size={40} className={`animate-spin ${activeTheme.text}`} />
        <p className="font-bold text-gray-600">対戦相手を探しています...</p>
        <p className="text-xs text-gray-400">※30秒経過するとAIプレイヤーと対戦が開始されます。</p>
        {gameId && (
          <button onClick={() => startAiMatchImmediately(gameId)} className={`mt-4 px-6 py-3 text-white font-bold rounded-xl shadow-sm active:scale-95 flex items-center justify-center space-x-2 ${activeTheme.primary}`}>
            <Bot size={20} /><span>今すぐAI対戦</span>
          </button>
        )}
        <button onClick={handleLeaveGame} className="mt-4 px-6 py-2 bg-gray-200 rounded-full text-sm font-bold text-gray-600">キャンセル</button>
      </div>
    );
    if (!gameState) return null;

    const { board, turn, status, player1Data, player2Data, player1, player2, resignedBy } = gameState;
    const { black: blackCount, white: whiteCount } = countStones(board);
    
    let myColor = playMode === 'local' ? turn : (player1 === user?.uid ? 'black' : 'white');
    let isMyTurn = playMode === 'room_spectator' ? false : turn === myColor;
    let validMoves = isMyTurn && status === 'playing' ? getValidMoves(board, myColor) : [];

    let winner = null;
    if (status === 'finished') {
      if (resignedBy) winner = resignedBy === player1 ? 'white' : 'black';
      else if (blackCount > whiteCount) winner = 'black';
      else if (whiteCount > blackCount) winner = 'white';
      else winner = 'draw';
    }

    return (
      <div className="p-4 flex flex-col h-full animate-in fade-in duration-300 relative">
        {toastMessage && (<div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-40 animate-in slide-in-from-top-10 fade-in duration-300"><div className="bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg font-bold text-sm flex items-center"><AlertTriangle size={18} className="text-yellow-400 mr-2" /> {toastMessage}</div></div>)}

        <div className="flex items-center justify-between mb-4">
           <button onClick={() => { if(playMode === 'ranked' && status === 'playing') setShowLeaveAlert(true); else handleLeaveGame(); }} className="p-2 bg-white rounded-full shadow-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={20} /></button>
           {playMode === 'room' && <span className="bg-white px-3 py-1 rounded-full text-xs font-bold font-mono tracking-widest shadow-sm">Room: {gameId}</span>}
           {playMode === 'room_spectator' && <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold flex items-center"><Eye size={14} className="mr-1"/> 観戦中</span>}
        </div>

        <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm mb-6 relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gray-100 rounded-t-xl overflow-hidden"><div className={`h-full transition-all duration-500 ${turn === 'black' ? 'bg-black w-1/2' : 'bg-white w-1/2 ml-auto'}`}></div></div>
          
          <div className={`flex flex-col items-center p-2 rounded-lg relative ${turn === 'black' ? activeTheme.light : ''}`}>
            {activeStamp && player1 && activeStamp.sender === player1 && (
              <div className="absolute -top-10 bg-white px-3 py-1.5 rounded-2xl shadow-lg border border-gray-100 text-xs font-bold z-20 whitespace-nowrap animate-in zoom-in slide-in-from-bottom-2 duration-200">
                {activeStamp.text}<div className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-gray-100 rotate-45"></div>
              </div>
            )}
            <div className="w-8 h-8 bg-black rounded-full shadow-md mb-1 border-2 border-transparent flex items-center justify-center">
              {player1?.startsWith('ai_bot_') && <span className="text-[10px] text-white font-mono opacity-50">AI</span>}
            </div>
            <span className="text-xs font-bold truncate w-20 text-center">{player1Data?.name}</span><span className="text-xs font-black mt-1">{blackCount}</span>
          </div>

          <div className="text-center">
            {status === 'waiting' && <span className="text-xs font-bold text-gray-400">参加者を待機中...</span>}
            {status === 'playing' && <span className={`text-sm font-bold ${activeTheme.text}`}>{playMode === 'room_spectator' ? (turn === 'black' ? '黒の番' : '白の番') : (isMyTurn ? "あなたの番です" : "相手の番です")}</span>}
            {status === 'finished' && <span className="text-sm font-bold text-red-500">決着！</span>}
          </div>

          <div className={`flex flex-col items-center p-2 rounded-lg relative ${turn === 'white' ? activeTheme.light : ''}`}>
            {activeStamp && player2 && activeStamp.sender === player2 && (
              <div className="absolute -top-10 bg-white px-3 py-1.5 rounded-2xl shadow-lg border border-gray-100 text-xs font-bold z-20 whitespace-nowrap animate-in zoom-in slide-in-from-bottom-2 duration-200">
                {activeStamp.text}<div className="absolute -bottom-1.5 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-gray-100 rotate-45"></div>
              </div>
            )}
            <div className="w-8 h-8 bg-white rounded-full shadow-md mb-1 border-2 border-gray-200 flex items-center justify-center">
              {player2?.startsWith('ai_bot_') && <span className="text-[10px] text-black font-mono opacity-50">AI</span>}
            </div>
            <span className="text-xs font-bold truncate w-20 text-center">{player2Data?.name || '---'}</span><span className="text-xs font-black mt-1">{whiteCount}</span>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className={`${activeTheme.board} p-1.5 rounded-lg shadow-2xl w-full max-w-[350px] aspect-square`}>
            <div className={`grid grid-cols-8 grid-rows-8 gap-0.5 h-full w-full ${activeTheme.grid} border-2 ${activeTheme.border}`}>
              {board.map((row, rIdx) => row.map((cell, cIdx) => {
                const isMoveable = validMoves.includes(`${rIdx},${cIdx}`);
                return (
                  <div key={`${rIdx}-${cIdx}`} onClick={() => isMoveable && handleMove(rIdx, cIdx)} className={`${activeTheme.cell} w-full h-full flex items-center justify-center relative ${isMoveable ? 'cursor-pointer hover:brightness-110' : ''}`}>
                    {cell && <div className={`w-[85%] h-[85%] rounded-full shadow-sm transition-all duration-300 transform scale-100 ${cell === 'black' ? 'bg-black' : 'bg-white border-gray-200 border'}`} />}
                    {isMoveable && <div className="w-2.5 h-2.5 bg-black opacity-20 rounded-full"></div>}
                  </div>
                );
              }))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex space-x-3 relative">
          {(playMode === 'ranked' || playMode === 'room') && status === 'playing' && (
            <div className="relative">
              <button onClick={() => setShowStampMenu(!showStampMenu)} className="bg-white text-gray-500 p-3 rounded-xl shadow-sm active:scale-95 border border-gray-100"><MessageCircle size={24} /></button>
              {showStampMenu && (<div className="absolute bottom-14 left-0 bg-white p-3 rounded-2xl shadow-xl border border-gray-100 grid grid-cols-2 gap-2 w-48 z-30 animate-in fade-in slide-in-from-bottom-2">{STAMPS.map((s, i) => (<button key={i} onClick={() => handleStamp(s)} className={`text-xs font-bold p-2 rounded-lg bg-gray-50 hover:${activeTheme.light} ${activeTheme.text} transition-colors`}>{s}</button>))}</div>)}
            </div>
          )}
          {playMode !== 'room_spectator' && (<button onClick={() => { if(playMode === 'local') setGameState({...gameState, status:'finished', resignedBy:gameState.turn}); else updateDoc(getGameRef(gameId), { status:'finished', resignedBy:user.uid }); }} disabled={status !== 'playing'} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-xl font-bold active:scale-95 disabled:opacity-50">投了</button>)}
          {playMode === 'local' && (<button onClick={() => { const h = localHistory.slice(0, -1); setLocalHistory(h); setGameState({ ...gameState, board: h[h.length - 1], turn: gameState.turn === 'black' ? 'white' : 'black' }); }} disabled={localHistory.length <= 1 || status !== 'playing'} className={`flex-1 text-white py-3 rounded-xl font-bold active:scale-95 disabled:opacity-50 ${activeTheme.primary}`}>待った</button>)}
        </div>

        {showLeaveAlert && (<div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"><div className="bg-white p-6 rounded-2xl w-full max-w-sm text-center"><AlertTriangle size={40} className="text-red-500 mx-auto mb-3" /><h3 className="font-bold text-gray-800 text-lg mb-2">対戦を退出しますか？</h3><p className="text-sm text-gray-600 mb-6">ランク戦の途中で退出すると、<strong>敗北扱いとなりレーティングが低下</strong>します。</p><div className="flex space-x-3"><button onClick={() => setShowLeaveAlert(false)} className="flex-1 py-3 bg-gray-100 font-bold rounded-xl text-gray-600">戻る</button><button onClick={handleLeaveGame} className="flex-1 py-3 bg-red-500 font-bold rounded-xl text-white">退出する</button></div></div></div>)}

        {status === 'finished' && (
          <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-40 animate-in fade-in">
            <div className="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full text-center space-y-4">
              <h2 className="text-2xl font-black text-gray-800">{playMode === 'room_spectator' ? (winner === 'draw' ? '引き分け' : (winner === 'black' ? '黒の勝利！' : '白の勝利！')) : (winner === 'draw' ? '引き分け' : (winner === myColor ? 'あなたの勝利！' : 'あなたの負け...'))}</h2>
              <div className="flex justify-center space-x-6 text-xl font-bold py-2"><span className={winner === 'black' ? activeTheme.text : 'text-gray-500'}>黒: {blackCount}</span><span className="text-gray-300">-</span><span className={winner === 'white' ? activeTheme.text : 'text-gray-500'}>白: {whiteCount}</span></div>
              {playMode === 'ranked' && !gameState.resignedBy && <p className="text-xs text-gray-500">戦績を更新しました</p>}
              {gameState.resignedBy && <p className="text-sm text-red-500 font-bold">相手の投了(退出)による決着</p>}
              <button onClick={handleLeaveGame} className={`w-full py-3 mt-4 text-white rounded-xl font-bold ${activeTheme.primary}`}>ホームに戻る</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderProfile = () => {
    const total = profile.wins + profile.losses + profile.draws;
    const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;
    const lossRate = total > 0 ? Math.round((profile.losses / total) * 100) : 0;
    const drawRate = total > 0 ? Math.round((profile.draws / total) * 100) : 0;
    
    const getRankTitle = (rate) => {
      if (rate >= 1800) return { title: 'マスター', color: 'bg-purple-100 text-purple-700 border-purple-300' };
      if (rate >= 1500) return { title: 'ダイヤ', color: 'bg-blue-100 text-blue-700 border-blue-300' };
      if (rate >= 1300) return { title: 'ゴールド', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
      if (rate >= 1100) return { title: 'シルバー', color: 'bg-gray-200 text-gray-800 border-gray-300' };
      if (rate >= 900) return { title: 'ブロンズ', color: 'bg-orange-100 text-orange-800 border-orange-300' };
      return { title: 'ビギナー', color: 'bg-green-100 text-green-800 border-green-300' };
    };
    const rank = getRankTitle(profile.rating);

    return (
      <div className="p-4 space-y-5 min-h-full animate-in fade-in duration-300 pb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 text-center relative overflow-hidden">
          <div className="w-20 h-20 bg-gray-100 rounded-full mx-auto mb-3 flex items-center justify-center border-2 border-gray-200 shadow-inner"><User size={36} className="text-gray-400" /></div>
          <h2 className="text-2xl font-black text-gray-800">{profile.name}</h2>
          <div className="mt-2 flex justify-center items-center space-x-2"><span className={`text-xs font-bold px-3 py-1 rounded-full border ${rank.color} flex items-center`}><Award size={14} className="mr-1" /> {rank.title}</span></div>
          <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-gray-100">
            <div className="flex flex-col items-center justify-center p-2 bg-gray-50 rounded-xl relative">
              <span className="text-[10px] font-bold text-gray-400 flex items-center mb-1"><Trophy size={12} className="mr-1 text-yellow-500" /> 現在</span>
              <div className="flex flex-col items-center">
                <div className="flex items-baseline space-x-1"><span className={`text-xl font-black ${activeTheme.text}`}>{profile.rating}</span><span className="text-xs font-bold text-gray-500">({currentRank ? `${currentRank}位` : '-'})</span></div>
                <div className="flex items-center space-x-3 mt-1.5 bg-white px-2.5 py-1 rounded-full shadow-sm border border-gray-100"><div className="flex items-center space-x-1"><span className="text-[9px] text-gray-400">位</span>{renderDiff('rank', dailyStats.rankDiff)}</div><div className="flex items-center space-x-1"><span className="text-[9px] text-gray-400">R</span>{renderDiff('rating', dailyStats.ratingDiff)}</div></div>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center p-2 bg-gray-50 rounded-xl">
              <span className="text-[10px] font-bold text-gray-400 flex items-center mb-1"><Medal size={12} className="mr-1 text-amber-600" /> 最高</span>
              <div className="flex items-baseline space-x-1"><span className="text-xl font-black text-gray-700">{profile.highestRating || profile.rating}</span><span className="text-xs font-bold text-gray-500">({profile.highestRank ? `${profile.highestRank}位` : '-'})</span></div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1">勝率</div><div className="text-xl font-black text-gray-800">{winRate}<span className="text-xs">%</span></div></div>
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1">総対局数</div><div className="text-xl font-black text-gray-800">{total}<span className="text-xs">戦</span></div></div>
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-center"><div className="text-xs text-gray-400 font-bold mb-1 flex items-center justify-center"><Flame size={12} className="text-orange-500 mr-0.5" /> 連勝数</div><div className="text-xl font-black text-orange-500">{profile.currentStreak || 0}<span className="text-xs">連勝</span></div></div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <h3 className="font-bold text-gray-800 text-sm">勝敗内訳</h3>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex"><div className="bg-emerald-500 h-full" style={{ width: `${winRate}%` }}></div><div className="bg-gray-300 h-full" style={{ width: `${drawRate}%` }}></div><div className="bg-red-500 h-full" style={{ width: `${lossRate}%` }}></div></div>
          <div className="flex justify-between text-xs text-gray-500 font-bold pt-1"><span className="flex items-center text-emerald-600"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1"></div>勝利: {profile.wins}</span><span className="flex items-center text-gray-500"><div className="w-2 h-2 rounded-full bg-gray-300 mr-1"></div>引分: {profile.draws}</span><span className="flex items-center text-red-500"><div className="w-2 h-2 rounded-full bg-red-500 mr-1"></div>敗北: {profile.losses}</span></div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <h3 className="font-bold text-gray-800 text-sm flex items-center"><History size={16} className="mr-1.5 text-gray-500" /> 対戦履歴 (直近)</h3>
          {(!profile.history || profile.history.length === 0) ? (<div className="text-center py-6 text-gray-400 text-xs">対戦履歴がありません</div>) : (
            <div className="space-y-2">
              {profile.history.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl text-xs">
                  <div className="flex items-center space-x-3">
                    <span className={`font-black px-2 py-1 rounded text-[10px] min-w-[36px] text-center ${item.result === 'win' ? 'bg-emerald-100 text-emerald-700' : item.result === 'loss' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700'}`}>{item.result === 'win' ? '勝利' : item.result === 'loss' ? '敗北' : '引分'}</span>
                    <div><div className="font-bold text-gray-800">{item.oppName}</div><div className="text-[10px] text-gray-400">{item.date}</div></div>
                  </div>
                  <div className="text-right"><div className={`font-mono font-bold ${item.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{item.change >= 0 ? `+${item.change}` : item.change}</div><div className="text-[10px] text-gray-400 font-mono">{item.myStones} - {item.oppStones}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="p-4 space-y-6 min-h-full animate-in fade-in duration-300 pb-8">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <div className="space-y-2"><label className="text-sm font-bold text-gray-700">プレイヤー名</label><input type="text" maxLength={10} value={profile.name} onChange={(e) => updateProfile({ name: e.target.value })} className={`w-full p-3 bg-gray-50 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-opacity-50 ${activeTheme.border}`} placeholder="名前" /></div>
        <div className="space-y-3 pt-2"><label className="text-sm font-bold text-gray-700 flex items-center"><Palette size={16} className="mr-1" /> テーマカラー</label><div className="grid grid-cols-3 gap-3">{Object.keys(THEMES).map((t) => (<button key={t} onClick={() => updateProfile({ theme: t })} className={`h-12 rounded-lg flex items-center justify-center transition-all ${THEMES[t].primary} ${profile.theme === t ? 'ring-4 ring-offset-2 ring-gray-200 scale-95' : 'opacity-80 hover:opacity-100'}`}>{profile.theme === t && <div className="w-2.5 h-2.5 bg-white rounded-full"></div>}</button>))}</div></div>
      </div>
      
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4 mt-6">
        <button onClick={() => setShowDeleteAlert(true)} className="w-full py-3 text-red-500 font-bold rounded-lg bg-red-50 hover:bg-red-100 transition-colors">
          データを削除する
        </button>
      </div>

      <div className="text-center text-xs text-gray-400 mt-8">User ID: {user?.uid?.slice(0, 8)}...</div>
    </div>
  );

  return (
    <div className="bg-gray-100 h-screen w-full flex justify-center font-sans overflow-hidden text-gray-800 select-none">
      <div className="w-full max-w-md h-full flex flex-col bg-gray-50 shadow-2xl relative">
        {currentTab !== 'play' && (
          <header className="bg-white pt-safe pb-4 px-6 shadow-sm z-10 flex justify-between items-center h-20">
            <h1 className="text-lg font-black tracking-tight mt-4">
              {currentTab === 'home' && 'Reversi Online'}
              {currentTab === 'friends' && 'フレンド'}
              {currentTab === 'profile' && 'プロフィール'}
              {currentTab === 'settings' && '設定'}
            </h1>
          </header>
        )}

        <main className="flex-1 overflow-y-auto pb-24 relative">
          {currentTab === 'home' && renderHome()}
          {currentTab === 'play' && renderGame()}
          {currentTab === 'friends' && renderFriends()}
          {currentTab === 'profile' && renderProfile()}
          {currentTab === 'settings' && renderSettings()}
        </main>

        {currentTab !== 'play' && (
          <nav className="absolute bottom-0 w-full bg-white border-t border-gray-200 pb-safe pt-2 px-6 flex justify-between items-center h-20 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
            {[
              { id: 'home', icon: Home, label: 'ホーム' }, 
              { id: 'friends', icon: Users, label: 'フレンド' }, 
              { id: 'profile', icon: User, label: '戦績' }, 
              { id: 'settings', icon: Settings, label: '設定' }
            ].map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button key={item.id} onClick={() => setCurrentTab(item.id)} className={`flex flex-col items-center justify-center w-16 h-full transition-colors ${isActive ? activeTheme.text : 'text-gray-400'}`}>
                  <Icon size={22} className={isActive ? 'mb-1 stroke-2' : 'stroke-[1.5px]'} />
                  <span className={`text-[10px] font-bold ${isActive ? 'opacity-100' : 'opacity-0 h-0'}`}>{item.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Delete Data Alert Modal */}
        {showDeleteAlert && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-6 rounded-2xl w-full max-w-sm text-center">
              <AlertTriangle size={40} className="text-red-500 mx-auto mb-3" />
              <h3 className="font-bold text-gray-800 text-lg mb-2">データを削除しますか？</h3>
              <p className="text-sm text-gray-600 mb-6">すべての戦績とプロフィールが削除され、初期状態に戻ります。この操作は取り消せません。</p>
              <div className="flex space-x-3">
                <button onClick={() => setShowDeleteAlert(false)} className="flex-1 py-3 bg-gray-100 font-bold rounded-xl text-gray-600">キャンセル</button>
                <button onClick={handleDeleteData} className="flex-1 py-3 bg-red-500 font-bold rounded-xl text-white">削除する</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ==========================================
// エラーキャッチ用 ラッパーコンポーネント
// ==========================================
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-50 text-red-900 min-h-screen w-full overflow-auto text-left">
          <h1 className="text-xl font-bold mb-4 border-b border-red-300 pb-2">システムエラーが発生しました</h1>
          <p className="mb-4 text-sm font-bold bg-white p-3 rounded text-red-600">{this.state.error?.toString()}</p>
          <pre className="text-[10px] bg-white p-3 rounded border border-red-200 overflow-x-auto whitespace-pre-wrap">
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <OthelloApp />
    </ErrorBoundary>
  );
}


