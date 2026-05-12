import { Search, History as HistoryIcon, Download, Music, User, Play, RefreshCw, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import axios from 'axios';
import { useState, useEffect } from 'react';
import vibeLogo from './assets/vibe-logo.png';

// Use relative paths so Vite proxy handles the port mapping
const API_BASE = '/api';

interface Video {
  id: string;
  title: string;
  thumbnails: { url: string }[];
  url: string;
}

interface DownloadRecord {
  id: string;
  youtube_url: string;
  artist: string;
  title: string;
  file_path: string;
  thumbnail_url: string;
  created_at: string;
  status?: 'ready' | 'expired' | 'checking';
}

interface UserProfile {
  id: string;
  username: string;
  name: string;
  is_admin: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'users'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [history, setHistory] = useState<DownloadRecord[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [metadata, setMetadata] = useState({ artist: '', title: '' });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Search source state
  const [searchSource, setSearchSource] = useState<'All' | 'Karafun' | 'Sing King' | 'Zoom'>('All');
  const [visibleResults, setVisibleResults] = useState(6);

  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // User Management state
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', is_admin: false });

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchMe();
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  useEffect(() => {
    if (activeTab === 'history' && token) {
      fetchHistory();
    }
    if (activeTab === 'users' && user?.is_admin) {
      fetchUsers();
    }
  }, [activeTab, token, user]);

  const fetchMe = async () => {
    try {
      const res = await axios.get(`${API_BASE}/me`);
      setUser(res.data);
    } catch (err) {
      handleLogout();
    }
  };

  const handleLogin = async (e: React.FormEvent, rememberMe: boolean) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    setIsLoggingIn(true);
    setLoginError('');
    try {
      const res = await axios.post(`${API_BASE}/login`, { username, password });
      const { token, user } = res.data;
      setToken(token);
      setUser(user);
      if (rememberMe) {
        localStorage.setItem('token', token);
      } else {
        sessionStorage.setItem('token', token);
      }
    } catch (err: any) {
      setLoginError(err.response?.data?.error || 'Login failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    sessionStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
  };

  const fetchHistory = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/history`);
      if (data) {
        const historyWithStatus = await Promise.all(data.map(async (item: DownloadRecord) => {
          try {
            const res = await axios.get(`${API_BASE}/status/${item.id}`);
            return { ...item, status: res.data.exists ? 'ready' : 'expired' };
          } catch {
            return { ...item, status: 'expired' };
          }
        }));
        setHistory(historyWithStatus as DownloadRecord[]);
      }
    } catch (error) {
      console.error('Failed to fetch history', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users`);
      setUsers(res.data);
    } catch (err) {
      console.error('Failed to fetch users');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/users`, newUser);
      setNewUser({ name: '', username: '', password: '', is_admin: false });
      fetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create user');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await axios.delete(`${API_BASE}/users/${id}`);
      fetchUsers();
    } catch (err) {
      alert('Failed to delete user');
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setVisibleResults(6);

    // Modify search query based on source
    let modifiedQuery = searchQuery;
    if (searchSource === 'All') {
      modifiedQuery = `${searchQuery} Karaoke`;
    } else {
      modifiedQuery = `${searchQuery} ${searchSource.toLowerCase()}`;
    }

    try {
      const res = await axios.post(`${API_BASE}/search`, { query: modifiedQuery });
      setSearchResults(res.data);
    } catch (error) {
      console.error('Search failed', error);
    } finally {
      setIsSearching(false);
    }
  };

  const startDownload = async () => {
    if (!selectedVideo || !metadata.artist || !metadata.title) return;
    setIsDownloading(true);
    setDownloadProgress(10);
    try {
      await axios.post(`${API_BASE}/download`, {
        url: selectedVideo.url,
        artist: metadata.artist,
        title: metadata.title,
        thumbnailUrl: selectedVideo.thumbnails[0]?.url
      });
      setSelectedVideo(null);
      setMetadata({ artist: '', title: '' });
      setActiveTab('history');
    } catch (error) {
      alert('Download failed. Please try again.');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  const handleRegenerate = async (id: string) => {
    try {
      setHistory(prev => prev.map(item => item.id === id ? { ...item, status: 'checking' } : item));
      await axios.post(`${API_BASE}/regenerate/${id}`);
      fetchHistory();
    } catch (error) {
      alert('Regeneration failed');
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-4">
        <div className="text-center mb-8 space-y-4">
          <img
            src={vibeLogo}
            alt="Vibe Karaoke & DJ"
            className="h-24 md:h-32 w-auto object-contain mx-auto"
          />
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-white">Vibe Karaoke & DJ</h1>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-[0.2em]">Authorized Personnel Only</p>
          </div>
        </div>

        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl">
          <form onSubmit={(e) => handleLogin(e, (e.currentTarget.elements.namedItem('remember') as HTMLInputElement).checked)} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Username</label>
              <input
                name="username"
                type="text"
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                placeholder="Enter your username"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Password</label>
              <input
                name="password"
                type="password"
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center gap-2 ml-1">
              <input type="checkbox" id="remember" name="remember" className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-red-600 focus:ring-red-600/50" />
              <label htmlFor="remember" className="text-sm text-zinc-400">Remember me</label>
            </div>

            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <AlertCircle size={16} /> {loginError}
              </div>
            )}

            <button
              disabled={isLoggingIn}
              className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 py-4 rounded-xl font-bold transition-all text-lg shadow-lg shadow-red-600/20 flex items-center justify-center gap-2"
            >
              {isLoggingIn ? <RefreshCw size={20} className="animate-spin" /> : 'Sign In'}
            </button>
          </form>
        </div>
        <p className="mt-8 text-zinc-600 text-xs text-center max-w-xs">
          Use of this system is restricted to authorized personnel only. All access and activity is logged.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">
      <nav className="border-b border-zinc-800 bg-[#0d0d0d] sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={vibeLogo} alt="Vibe Logo" className="h-8 w-auto object-contain" />
            <span className="font-bold text-lg tracking-tight hidden sm:inline">VIBE PRO</span>
          </div>

          <div className="flex gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setActiveTab('search')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'search' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <Search size={16} /> <span className="hidden xs:inline">Search</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'history' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <HistoryIcon size={16} /> <span className="hidden xs:inline">History</span>
            </button>
            {user?.is_admin && (
              <button
                onClick={() => setActiveTab('users')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${activeTab === 'users' ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                <User size={16} /> <span className="hidden xs:inline">Users</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-xs font-semibold text-zinc-200">{user?.name}</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-tighter">{user?.is_admin ? 'Administrator' : 'Staff'}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-zinc-500 hover:text-white transition-colors p-2"
              title="Logout"
            >
              <AlertCircle size={20} className="rotate-180" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8 min-h-[calc(100vh-140px)]">
        {activeTab === 'search' ? (
          <div className="space-y-10">
            <div className="max-w-3xl mx-auto space-y-6">
              <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for karaoke videos"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all text-lg"
                  />
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                </div>

                <div className="flex gap-3">
                  <div className="relative">
                    <select
                      value={searchSource}
                      onChange={(e) => setSearchSource(e.target.value as any)}
                      className="appearance-none bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-5 pr-10 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all text-lg min-w-[140px] cursor-pointer"
                    >
                      <option value="All">All</option>
                      <option value="Karafun">Karafun</option>
                      <option value="Sing King">Sing King</option>
                      <option value="Zoom">Zoom</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                  </div>

                  <button
                    disabled={isSearching}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-8 py-4 rounded-2xl font-bold transition-all shadow-lg shadow-red-600/20 whitespace-nowrap"
                  >
                    {isSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>
              </form>

              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle className="text-zinc-500 mt-0.5 shrink-0" size={18} />
                <p className="text-sm text-zinc-400">
                  <span className="text-zinc-300 font-medium">Pro Tip:</span> For best results, enter the artist name and song title (e.g. <span className="italic text-zinc-300">"Morgan Wallen Last Night"</span>).
                </p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {searchResults.slice(0, visibleResults).map((video) => (
                  <div
                    key={video.id}
                    className="group bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-all"
                  >
                    <div className="aspect-video relative overflow-hidden">
                      <img
                        src={video.thumbnails[0]?.url}
                        alt={video.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={() => setSelectedVideo(video)}
                          className="bg-white text-black p-3 rounded-full transform translate-y-4 group-hover:translate-y-0 transition-transform"
                        >
                          <Download size={24} />
                        </button>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-medium line-clamp-2 text-zinc-200">{video.title}</h3>
                    </div>
                  </div>
                ))}
              </div>

              {searchResults.length > visibleResults && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => setVisibleResults(prev => prev + 6)}
                    className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-8 py-3 rounded-xl font-semibold transition-all flex items-center gap-2"
                  >
                    <ChevronDown size={18} />
                    Show More Results
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'history' ? (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Download History</h2>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80">
                    <th className="px-6 py-4 text-sm font-semibold text-zinc-400">Video</th>
                    <th className="px-6 py-4 text-sm font-semibold text-zinc-400">Metadata</th>
                    <th className="px-6 py-4 text-sm font-semibold text-zinc-400">Status</th>
                    <th className="px-6 py-4 text-sm font-semibold text-zinc-400 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img src={item.thumbnail_url} className="w-20 aspect-video rounded-lg object-cover shadow-lg" />
                          <span className="text-sm font-medium line-clamp-1 max-w-[200px]">{item.title}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <User size={12} /> {item.artist}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <Music size={12} /> {item.title}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {item.status === 'ready' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-medium">
                            <CheckCircle2 size={14} /> File Ready
                          </span>
                        ) : item.status === 'checking' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-500 text-xs font-medium animate-pulse">
                            <RefreshCw size={14} className="animate-spin" /> Processing
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 text-xs font-medium">
                            <AlertCircle size={14} /> Expired
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {item.status === 'ready' ? (
                          <a
                            href={`/files/${encodeURIComponent(item.file_path)}`}
                            download
                            className="inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          >
                            <Download size={16} /> Download
                          </a>
                        ) : (
                          <button
                            onClick={() => handleRegenerate(item.id)}
                            className="inline-flex items-center gap-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          >
                            <RefreshCw size={16} /> Regenerate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold">User Management</h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1">
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
                  <h3 className="font-bold text-lg">Create New User</h3>
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Full Name</label>
                      <input
                        type="text"
                        value={newUser.name}
                        onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                        placeholder="John Doe"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Username</label>
                      <input
                        type="text"
                        value={newUser.username}
                        onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                        placeholder="jdoe"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Password</label>
                      <input
                        type="password"
                        value={newUser.password}
                        onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-2 px-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                        placeholder="••••••••"
                        required
                      />
                    </div>
                    <div className="flex items-center gap-2 py-2">
                      <input
                        type="checkbox"
                        id="is_admin"
                        checked={newUser.is_admin}
                        onChange={e => setNewUser({ ...newUser, is_admin: e.target.checked })}
                        className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-red-600 focus:ring-red-600/50"
                      />
                      <label htmlFor="is_admin" className="text-sm text-zinc-400 font-medium">Administrator Privileges</label>
                    </div>
                    <button className="w-full bg-red-600 hover:bg-red-700 py-3 rounded-xl font-bold transition-all shadow-lg shadow-red-600/10">
                      Create User
                    </button>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/80">
                        <th className="px-6 py-4 text-sm font-semibold text-zinc-400">User</th>
                        <th className="px-6 py-4 text-sm font-semibold text-zinc-400">Role</th>
                        <th className="px-6 py-4 text-sm font-semibold text-zinc-400">Status</th>
                        <th className="px-6 py-4 text-sm font-semibold text-zinc-400 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 font-bold">
                                {u.name.charAt(0)}
                              </div>
                              <div>
                                <div className="text-sm font-medium">{u.name}</div>
                                <div className="text-xs text-zinc-500">@{u.username}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {u.is_admin ? (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">Admin</span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 bg-zinc-500/10 px-2 py-0.5 rounded-full border border-zinc-500/20">Staff</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block mr-2 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                            <span className="text-xs text-zinc-300">Active</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleDeleteUser(u.id)}
                              disabled={u.id === user?.id}
                              className="text-zinc-600 hover:text-red-500 transition-colors disabled:opacity-0"
                            >
                              <AlertCircle size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {selectedVideo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Download Settings</h3>
                <p className="text-zinc-400 text-sm">Customize the metadata for your MP4 file.</p>
              </div>

              <div className="aspect-video rounded-2xl overflow-hidden border border-zinc-800">
                <img src={selectedVideo.thumbnails[0]?.url} className="w-full h-full object-cover" />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Artist</label>
                  <input
                    type="text"
                    value={metadata.artist}
                    onChange={(e) => setMetadata({ ...metadata, artist: e.target.value })}
                    placeholder="e.g. Hans Zimmer"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Title</label>
                  <input
                    type="text"
                    value={metadata.title}
                    onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                    placeholder="e.g. Interstellar Main Theme"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-red-600/50 transition-all"
                  />
                </div>
              </div>

              {isDownloading && (
                <div className="space-y-2">
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-600 transition-all duration-500"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <p className="text-center text-xs text-zinc-500 animate-pulse">Processing high-quality encode...</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setSelectedVideo(null)}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 py-3 rounded-xl font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={startDownload}
                  disabled={isDownloading || !metadata.artist || !metadata.title}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {isDownloading ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
                  {isDownloading ? 'Downloading...' : 'Start Download'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <footer className="border-t border-zinc-800 bg-[#0d0d0d] py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-zinc-500 text-sm">
          <div className="flex items-center gap-2">
            <img src={vibeLogo} alt="Vibe Logo" className="h-5 w-auto grayscale opacity-50" />
            <span>&copy; {new Date().getFullYear()} Vibe Karaoke & DJ. All rights reserved.</span>
          </div>
          <div className="flex gap-6">
            <span className="hover:text-zinc-300 cursor-help transition-colors">Terms of Use</span>
            <span className="hover:text-zinc-300 cursor-help transition-colors">Privacy Policy</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
