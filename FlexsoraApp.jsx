import React, { useState, useEffect, useRef } from 'react';
import { 
  UserCircle, Briefcase, Search, PlusCircle, LogOut, 
  CheckCircle, LayoutDashboard, ShoppingCart, Star, Video, PenTool, Code,
  MessageSquare, Send, Clock, DollarSign, ChevronRight, X
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, 
  onAuthStateChanged, signOut, signInAnonymously, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, doc, setDoc, addDoc, deleteDoc, updateDoc 
} from 'firebase/firestore';

// ============================================================================
// FIREBASE CONFIGURATION & INITIALIZATION
// ============================================================================
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'flexsora-dev';

// RAZORPAY CONFIG - Replace with your live Key ID when deploying
const RAZORPAY_KEY_ID = "rzp_test_YOUR_KEY_HERE"; 

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================
export default function App() {
  // --- STATE MANAGEMENT ---
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null); // 'buyer' or 'freelancer'
  const [activeTab, setActiveTab] = useState('home'); // home, browse, dashboard, gigDetail, chat
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  
  // Data State
  const [gigs, setGigs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [chats, setChats] = useState([]);
  
  // Selection State
  const [selectedGig, setSelectedGig] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messageText, setMessageText] = useState('');

  // Form State
  const [newGig, setNewGig] = useState({ title: '', description: '', price: '', category: 'Video Editing' });
  const chatEndRef = useRef(null);

  // --- 1. AUTHENTICATION & ROLE FETCHING ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth init error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const profileRef = collection(db, 'artifacts', appId, 'users', user.uid, 'profile');
    const unsubscribe = onSnapshot(profileRef, (snapshot) => {
      let roleFound = false;
      snapshot.forEach((doc) => {
        if (doc.id === 'userRole') {
          setUserRole(doc.data().role);
          roleFound = true;
        }
      });
      if (!roleFound) setUserRole(null);
    }, console.error);
    return () => unsubscribe();
  }, [user]);

  // --- 2. GLOBAL DATA FETCHING (Public Data) ---
  useEffect(() => {
    if (!user) return;

    // Fetch Gigs
    const gigsSub = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'gigs'), (snapshot) => {
      const g = [];
      snapshot.forEach(doc => g.push({ id: doc.id, ...doc.data() }));
      setGigs(g.sort((a, b) => b.createdAt - a.createdAt));
    }, console.error);

    // Fetch Orders
    const ordersSub = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), (snapshot) => {
      const o = [];
      snapshot.forEach(doc => o.push({ id: doc.id, ...doc.data() }));
      setOrders(o.sort((a, b) => b.createdAt - a.createdAt));
    }, console.error);

    // Fetch Chats
    const chatsSub = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'chats'), (snapshot) => {
      const c = [];
      snapshot.forEach(doc => c.push({ id: doc.id, ...doc.data() }));
      setChats(c.sort((a, b) => b.lastUpdated - a.lastUpdated));
    }, console.error);

    return () => { gigsSub(); ordersSub(); chatsSub(); };
  }, [user]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (activeTab === 'chat' && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chats, activeTab]);

  // Load Razorpay Script
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  // --- ACTIONS & HANDLERS ---
  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      setAuthError("Login popup blocked by preview. It will work when deployed!");
    }
  };

  const handleLogout = () => { signOut(auth); setActiveTab('home'); };

  const selectRole = async (role) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'userRole'), { role, updatedAt: Date.now() });
      setUserRole(role);
      setActiveTab('dashboard');
    } catch (error) {
      console.error("Error setting role:", error);
    }
  };

  const handleCreateGig = async (e) => {
    e.preventDefault();
    if (!user || userRole !== 'freelancer') return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'gigs'), {
        ...newGig, price: parseFloat(newGig.price), freelancerId: user.uid, freelancerName: user.displayName || 'Freelancer', createdAt: Date.now()
      });
      setNewGig({ title: '', description: '', price: '', category: 'Video Editing' });
    } catch (error) { console.error("Error adding gig:", error); }
  };

  // --- RAZORPAY PAYMENT FLOW ---
  const handlePurchaseGig = (gig) => {
    if (!user || user.isAnonymous) return alert("Please sign in to purchase.");
    if (userRole !== 'buyer') return alert("Only buyers can purchase gigs.");

    const options = {
      key: RAZORPAY_KEY_ID,
      amount: gig.price * 100, // Razorpay works in smallest currency unit (cents/paise)
      currency: "USD",
      name: "Flexsora",
      description: `Payment for ${gig.title}`,
      handler: async function (response) {
        // Payment Success Handler
        try {
          // 1. Create the Order
          await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), {
            gigId: gig.id,
            gigTitle: gig.title,
            price: gig.price,
            buyerId: user.uid,
            buyerName: user.displayName || 'Buyer',
            freelancerId: gig.freelancerId,
            freelancerName: gig.freelancerName,
            status: 'In Progress',
            paymentId: response.razorpay_payment_id,
            createdAt: Date.now()
          });

          // 2. Initiate a Chat thread automatically
          const chatRef = collection(db, 'artifacts', appId, 'public', 'data', 'chats');
          // Check if chat already exists
          const existingChat = chats.find(c => c.gigId === gig.id && c.buyerId === user.uid);
          
          if (!existingChat) {
            await addDoc(chatRef, {
              gigId: gig.id,
              gigTitle: gig.title,
              buyerId: user.uid,
              buyerName: user.displayName || 'Buyer',
              freelancerId: gig.freelancerId,
              freelancerName: gig.freelancerName,
              messages: [{
                senderId: 'system',
                text: `Order placed successfully! Payment ID: ${response.razorpay_payment_id}. You can start discussing the project requirements.`,
                timestamp: Date.now()
              }],
              lastUpdated: Date.now()
            });
          }
          
          alert("Payment successful! Order created.");
          setActiveTab('dashboard');
        } catch (err) {
          console.error("Order creation failed", err);
        }
      },
      prefill: {
        name: user.displayName || '',
        email: user.email || ''
      },
      theme: { color: "#4f46e5" }
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', function (response){
        alert(`Payment Failed: ${response.error.description}`);
    });
    rzp.open();
  };

  // --- CHAT SYSTEM ---
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageText.trim() || !activeChatId) return;

    const chatDoc = chats.find(c => c.id === activeChatId);
    if (!chatDoc) return;

    const newMessage = {
      senderId: user.uid,
      senderName: user.displayName || 'User',
      text: messageText,
      timestamp: Date.now()
    };

    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'chats', activeChatId), {
        messages: [...(chatDoc.messages || []), newMessage],
        lastUpdated: Date.now()
      });
      setMessageText('');
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  const openChat = (chatId) => {
    setActiveChatId(chatId);
    setActiveTab('chat');
  };

  // ============================================================================
  // UI RENDERERS
  // ============================================================================
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading Flexsora...</div>;

  // Role Selection
  if (user && !user.isAnonymous && !userRole) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <h2 className="text-3xl font-bold mb-2">Welcome to Flexsora!</h2>
          <p className="text-gray-500 mb-8">Choose your path:</p>
          <div className="space-y-4">
            <button onClick={() => selectRole('buyer')} className="w-full flex items-center justify-center space-x-3 p-4 border-2 border-indigo-100 rounded-xl hover:border-indigo-600 transition-all">
              <ShoppingCart className="text-indigo-600" />
              <div className="text-left">
                <h3 className="font-bold">I am a Buyer</h3>
                <p className="text-sm text-gray-500">Hire talented freelancers</p>
              </div>
            </button>
            <button onClick={() => selectRole('freelancer')} className="w-full flex items-center justify-center space-x-3 p-4 border-2 border-emerald-100 rounded-xl hover:border-emerald-600 transition-all">
              <Briefcase className="text-emerald-600" />
              <div className="text-left">
                <h3 className="font-bold">I am a Freelancer</h3>
                <p className="text-sm text-gray-500">Offer my services</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Filter Memory Data
  const myOrders = orders.filter(o => userRole === 'buyer' ? o.buyerId === user?.uid : o.freelancerId === user?.uid);
  const myChats = chats.filter(c => c.buyerId === user?.uid || c.freelancerId === user?.uid);
  const myGigs = gigs.filter(g => g.freelancerId === user?.uid);
  const activeChatData = chats.find(c => c.id === activeChatId);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-indigo-100">
      
      {/* NAVBAR */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-8">
              <div className="flex items-center space-x-2 cursor-pointer" onClick={() => setActiveTab('home')}>
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">F</div>
                <span className="text-xl font-extrabold">Flexsora</span>
              </div>
              
              {user && !user.isAnonymous && userRole && (
                <div className="hidden md:flex space-x-2">
                  <button onClick={() => setActiveTab('browse')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'browse' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`}>Browse</button>
                  <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'dashboard' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-100'}`}>Dashboard</button>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-4">
              {(!user || user.isAnonymous) ? (
                <button onClick={handleGoogleLogin} className="flex items-center space-x-2 bg-indigo-600 text-white px-5 py-2 rounded-full font-medium hover:bg-indigo-700 transition">
                  <UserCircle className="w-5 h-5" /><span>Sign in</span>
                </button>
              ) : (
                <div className="flex items-center space-x-4">
                  {myChats.length > 0 && (
                     <button onClick={() => { setActiveTab('dashboard'); }} className="relative p-2 text-gray-500 hover:text-indigo-600 transition">
                       <MessageSquare className="w-5 h-5" />
                       <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"></span>
                     </button>
                  )}
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-sm font-bold">{user.displayName || 'User'}</span>
                    <span className="text-xs text-indigo-600 font-medium capitalize">{userRole}</span>
                  </div>
                  <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-600 transition"><LogOut className="w-5 h-5" /></button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {authError && <div className="bg-amber-50 p-3 text-center text-amber-800 text-sm border-b">{authError}</div>}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* --- HOME VIEW --- */}
        {activeTab === 'home' && (
          <div className="py-12 text-center space-y-12">
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-tight">
              The Elite Network for <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-emerald-500">Digital Freelancers</span>
            </h1>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">Seamless payments, instant chat, and top-tier talent. Everything you need to get the job done.</p>
            {(!user || user.isAnonymous) && (
              <button onClick={handleGoogleLogin} className="bg-gray-900 text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-indigo-600 shadow-xl transition-all">Join Flexsora Now</button>
            )}
          </div>
        )}

        {/* --- BROWSE VIEW --- */}
        {activeTab === 'browse' && (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold">Explore Services</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {gigs.map(gig => (
                <div key={gig.id} onClick={() => { setSelectedGig(gig); setActiveTab('gigDetail'); }} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-xl cursor-pointer transition flex flex-col group">
                  <div className="h-40 bg-gray-100 flex items-center justify-center group-hover:bg-indigo-50 transition">
                    {gig.category === 'Video Editing' && <Video className="w-12 h-12 text-gray-400" />}
                    {gig.category === 'Design' && <PenTool className="w-12 h-12 text-gray-400" />}
                    {gig.category === 'Development' && <Code className="w-12 h-12 text-gray-400" />}
                  </div>
                  <div className="p-5 flex flex-col flex-grow">
                    <span className="text-xs font-bold text-indigo-600 uppercase mb-2">{gig.category}</span>
                    <h3 className="text-lg font-bold mb-2 line-clamp-2">{gig.title}</h3>
                    <p className="text-gray-500 text-sm mb-4 line-clamp-2">{gig.description}</p>
                    <div className="mt-auto flex justify-between items-center pt-4 border-t border-gray-100">
                      <span className="text-sm font-medium text-gray-600">By {gig.freelancerName}</span>
                      <span className="font-bold text-lg text-emerald-600">${gig.price}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- GIG DETAIL VIEW --- */}
        {activeTab === 'gigDetail' && selectedGig && (
          <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="p-8">
              <button onClick={() => setActiveTab('browse')} className="text-gray-500 hover:text-indigo-600 font-medium text-sm flex items-center mb-6">
                <ChevronRight className="w-4 h-4 mr-1 rotate-180" /> Back to listings
              </button>
              <div className="flex flex-col md:flex-row gap-12">
                <div className="flex-1 space-y-6">
                  <h1 className="text-4xl font-extrabold">{selectedGig.title}</h1>
                  <div className="flex items-center space-x-3 text-sm text-gray-500">
                    <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-bold">{selectedGig.category}</span>
                    <span className="flex items-center"><UserCircle className="w-4 h-4 mr-1"/> {selectedGig.freelancerName}</span>
                  </div>
                  <div className="prose text-gray-600">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">About this gig</h3>
                    <p className="whitespace-pre-line">{selectedGig.description}</p>
                  </div>
                </div>
                
                <div className="w-full md:w-80 space-y-6">
                  <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200">
                    <div className="text-3xl font-bold text-gray-900 mb-4">${selectedGig.price}</div>
                    <ul className="space-y-3 text-sm text-gray-600 mb-6">
                      <li className="flex items-center"><CheckCircle className="w-4 h-4 text-emerald-500 mr-2"/> Secure Escrow Payment</li>
                      <li className="flex items-center"><CheckCircle className="w-4 h-4 text-emerald-500 mr-2"/> Real-time Collaboration</li>
                      <li className="flex items-center"><CheckCircle className="w-4 h-4 text-emerald-500 mr-2"/> 100% Satisfaction</li>
                    </ul>
                    <button 
                      onClick={() => handlePurchaseGig(selectedGig)}
                      className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition flex items-center justify-center shadow-lg"
                    >
                      <DollarSign className="w-5 h-5 mr-1" /> Buy Securely with Razorpay
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- DASHBOARD VIEW --- */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <h2 className="text-3xl font-bold">Your Workspace</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Left Column: Actions & Stats */}
              <div className="lg:col-span-1 space-y-6">
                
                {/* Freelancer Tools */}
                {userRole === 'freelancer' && (
                  <div className="bg-white p-6 rounded-2xl border border-gray-200">
                    <h3 className="font-bold mb-4 flex items-center"><PlusCircle className="w-5 h-5 mr-2 text-indigo-600"/> Create New Gig</h3>
                    <form onSubmit={handleCreateGig} className="space-y-4">
                      <input type="text" placeholder="Gig Title" required value={newGig.title} onChange={e => setNewGig({...newGig, title: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"/>
                      <select value={newGig.category} onChange={e => setNewGig({...newGig, category: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm">
                        <option>Video Editing</option><option>Design</option><option>Development</option>
                      </select>
                      <input type="number" placeholder="Price ($)" required value={newGig.price} onChange={e => setNewGig({...newGig, price: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"/>
                      <textarea placeholder="Description" required rows="3" value={newGig.description} onChange={e => setNewGig({...newGig, description: e.target.value})} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm resize-none"></textarea>
                      <button type="submit" className="w-full bg-indigo-600 text-white py-2 rounded-lg font-bold text-sm">Publish Service</button>
                    </form>
                  </div>
                )}

                {/* Shared: Active Chats */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200">
                  <h3 className="font-bold mb-4 flex items-center"><MessageSquare className="w-5 h-5 mr-2 text-indigo-600"/> Your Messages</h3>
                  {myChats.length === 0 ? (
                    <p className="text-sm text-gray-500">No active conversations.</p>
                  ) : (
                    <div className="space-y-3">
                      {myChats.map(chat => (
                        <div key={chat.id} onClick={() => openChat(chat.id)} className="p-3 bg-gray-50 rounded-lg hover:bg-indigo-50 cursor-pointer transition border border-gray-100">
                          <p className="font-bold text-sm text-gray-900 truncate">{chat.gigTitle}</p>
                          <p className="text-xs text-gray-500">
                            with {userRole === 'buyer' ? chat.freelancerName : chat.buyerName}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Orders & Gigs */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* Orders Section */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200">
                  <h3 className="font-bold mb-4 flex items-center"><Clock className="w-5 h-5 mr-2 text-indigo-600"/> Active Orders</h3>
                  {myOrders.length === 0 ? (
                    <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                      <p className="text-gray-500">No active orders right now.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {myOrders.map(order => (
                        <div key={order.id} className="p-4 border border-gray-100 rounded-xl flex justify-between items-center bg-gray-50">
                          <div>
                            <span className="text-xs font-bold text-indigo-600 bg-indigo-100 px-2 py-1 rounded">{order.status}</span>
                            <h4 className="font-bold text-gray-900 mt-2">{order.gigTitle}</h4>
                            <p className="text-xs text-gray-500 mt-1">
                              {userRole === 'buyer' ? `Freelancer: ${order.freelancerName}` : `Buyer: ${order.buyerName}`}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-emerald-600">${order.price}</div>
                            <div className="text-xs text-gray-400 mt-1">ID: {order.paymentId.substring(0,8)}...</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Freelancer Gigs List */}
                {userRole === 'freelancer' && (
                  <div className="bg-white p-6 rounded-2xl border border-gray-200">
                    <h3 className="font-bold mb-4 flex items-center"><Briefcase className="w-5 h-5 mr-2 text-indigo-600"/> Your Published Gigs</h3>
                    {myGigs.length === 0 ? (
                       <p className="text-sm text-gray-500">You haven't published anything yet.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {myGigs.map(gig => (
                           <div key={gig.id} className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                              <h4 className="font-bold text-sm truncate">{gig.title}</h4>
                              <p className="text-emerald-600 font-bold text-sm mt-1">${gig.price}</p>
                           </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- CHAT INTERFACE --- */}
        {activeTab === 'chat' && activeChatData && (
          <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm h-[600px] flex flex-col">
            
            {/* Chat Header */}
            <div className="bg-indigo-600 p-4 text-white flex justify-between items-center">
              <div>
                <h3 className="font-bold">{activeChatData.gigTitle}</h3>
                <p className="text-indigo-200 text-xs">
                  Chatting with {userRole === 'buyer' ? activeChatData.freelancerName : activeChatData.buyerName}
                </p>
              </div>
              <button onClick={() => setActiveTab('dashboard')} className="p-2 hover:bg-indigo-500 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-gray-50">
              {activeChatData.messages && activeChatData.messages.map((msg, index) => {
                const isMe = msg.senderId === user.uid;
                const isSystem = msg.senderId === 'system';

                if (isSystem) {
                  return (
                    <div key={index} className="flex justify-center my-4">
                      <span className="bg-amber-100 text-amber-800 text-xs px-3 py-1 rounded-full font-medium shadow-sm">
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={index} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <span className="text-xs text-gray-400 mb-1 ml-1">{msg.senderName}</span>
                    <div className={`px-4 py-2 rounded-2xl max-w-[80%] ${isMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-gray-200 text-gray-900 rounded-tl-none shadow-sm'}`}>
                      {msg.text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-gray-200 flex space-x-2">
              <input 
                type="text" 
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <button type="submit" disabled={!messageText.trim()} className="bg-indigo-600 text-white p-2 w-10 h-10 rounded-full flex items-center justify-center hover:bg-indigo-700 disabled:opacity-50 transition">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

      </main>
    </div>
  );
}
